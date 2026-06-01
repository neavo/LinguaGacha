import { app, crashReporter, type BrowserWindow } from "electron";

import type { DesktopRendererDiagnosticsPayload } from "../bridge/bridge-types";
import {
  normalize_renderer_diagnostics_payload,
  sanitize_log_error_context,
  summarize_log_error_path,
  summarize_log_error_url,
  type LogErrorContext,
} from "../../shared/error";

export type RendererWindowKind = "main" | "log" | "unknown";

export type RendererProcessDiagnosticsRegistry = {
  registerWindow: (
    target_window: BrowserWindow,
    kind: Exclude<RendererWindowKind, "unknown">,
  ) => void;
  recordRendererDiagnostics: (
    sender: Electron.WebContents,
    payload: DesktopRendererDiagnosticsPayload,
  ) => void;
  buildRendererProcessGoneContext: (
    target_window: BrowserWindow,
    details: Electron.RenderProcessGoneDetails,
  ) => Record<string, unknown>;
  buildWindowUnresponsiveContext: (target_window: BrowserWindow) => Record<string, unknown>;
};

type RendererDiagnosticsBreadcrumb = {
  capturedAt: string; // main 收到面包屑的时间，避免依赖 renderer 崩溃前的系统时钟状态
  event: LogErrorContext; // 已脱敏的事件头摘要，不保存完整事件 payload
};

type RendererDiagnosticsContext = {
  capturedAt: string; // 当前 route / project / task 摘要的最后更新时间
  route?: string;
  project?: LogErrorContext;
  task?: LogErrorContext;
};

type RendererWindowDiagnosticsState = {
  windowKind: RendererWindowKind; // 区分主窗口和日志窗口，避免崩溃归因混淆
  webContentsId: number; // IPC sender 与窗口状态对齐的稳定键
  createdAt: string; // 帮助判断崩溃发生在首屏、热重载还是长时间任务后
  lastSeenAt: string; // 当前诊断上下文的新鲜度
  lastUrlIdentity: LogErrorContext; // 只保留宿主 URL 摘要，避免日志暴露完整地址
  osProcessId: number | null; // 用于匹配 Electron app metrics 与 Crashpad 文件
  lastRendererDiagnostics: RendererDiagnosticsContext | null; // 保存最新 route/project/task 摘要
  recentRendererEvents: RendererDiagnosticsBreadcrumb[]; // 固定长度事件面包屑
};

// RECENT RENDERER EVENT LIMIT 是运行时节流或容量阈值，集中保存便于评估性能影响。
const RECENT_RENDERER_EVENT_LIMIT = 32;

let renderer_crash_reporting_configured = false;

/**
 * 启用 Electron Crashpad 本地崩溃收集；上传关闭，崩溃文件只留在本机 crashDumps 目录。
 */
export function configure_renderer_crash_reporting(): void {
  if (renderer_crash_reporting_configured) {
    return;
  }

  crashReporter.start({
    productName: "LinguaGacha",
    uploadToServer: false,
    globalExtra: {
      component: "electron-renderer",
    },
  });
  renderer_crash_reporting_configured = true;
}

/**
 * 创建 renderer 进程诊断注册器，由 main 持有窗口身份、轻量面包屑和崩溃时的宿主快照。
 */
export function create_renderer_process_diagnostics_registry(): RendererProcessDiagnosticsRegistry {
  const windows_by_web_contents_id = new Map<number, RendererWindowDiagnosticsState>(); // webContents.id 是窗口诊断状态的唯一索引

  /**
   * 注册窗口宿主身份，并在窗口关闭时释放诊断状态。
   */
  function registerWindow(
    target_window: BrowserWindow,
    kind: Exclude<RendererWindowKind, "unknown">,
  ): void {
    const state = create_window_diagnostics_state(target_window, kind);
    windows_by_web_contents_id.set(state.webContentsId, state);
    target_window.once("closed", () => {
      windows_by_web_contents_id.delete(state.webContentsId);
    });
  }

  /**
   * 接收 preload 转发的 renderer 轻量诊断，刷新窗口快照和事件面包屑。
   */
  function recordRendererDiagnostics(
    sender: Electron.WebContents,
    payload: DesktopRendererDiagnosticsPayload,
  ): void {
    const state = windows_by_web_contents_id.get(sender.id);
    if (state === undefined) {
      return;
    }

    const diagnostics_payload = normalize_renderer_diagnostics_payload(payload);
    refresh_window_run_state(state, sender);
    if (
      diagnostics_payload.route !== undefined ||
      diagnostics_payload.project !== undefined ||
      diagnostics_payload.task !== undefined
    ) {
      state.lastRendererDiagnostics = {
        capturedAt: new Date().toISOString(),
        ...(diagnostics_payload.route === undefined ? {} : { route: diagnostics_payload.route }),
        ...(diagnostics_payload.project === undefined
          ? {}
          : { project: diagnostics_payload.project }),
        ...(diagnostics_payload.task === undefined ? {} : { task: diagnostics_payload.task }),
      };
    }
    if (diagnostics_payload.event !== undefined) {
      state.recentRendererEvents.push({
        capturedAt: new Date().toISOString(),
        event: diagnostics_payload.event,
      });
      while (state.recentRendererEvents.length > RECENT_RENDERER_EVENT_LIMIT) {
        state.recentRendererEvents.shift();
      }
    }
  }

  /**
   * 将 Electron render-process-gone 事件转换成可写入日志的结构化上下文。
   */
  function buildRendererProcessGoneContext(
    target_window: BrowserWindow,
    details: Electron.RenderProcessGoneDetails,
  ): Record<string, unknown> {
    const state = read_or_create_transient_window_state(target_window);
    return {
      reason: details.reason,
      exitCode: details.exitCode,
      electronDetails: sanitize_log_error_context(details as unknown as Record<string, unknown>),
      ...build_window_context(state, target_window.webContents),
    };
  }

  /**
   * 构造窗口卡死诊断上下文，复用崩溃日志的同一组宿主字段。
   */
  function buildWindowUnresponsiveContext(target_window: BrowserWindow): Record<string, unknown> {
    const state = read_or_create_transient_window_state(target_window);
    return build_window_context(state, target_window.webContents);
  }

  /**
   * 读取已登记窗口状态；未登记窗口只构造一次性快照，不回写注册表。
   */
  function read_or_create_transient_window_state(
    target_window: BrowserWindow,
  ): RendererWindowDiagnosticsState {
    const existing_state = windows_by_web_contents_id.get(target_window.webContents.id);
    if (existing_state !== undefined) {
      refresh_window_run_state(existing_state, target_window.webContents);
      return existing_state;
    }

    return create_window_diagnostics_state(target_window, "unknown");
  }

  return {
    registerWindow,
    recordRendererDiagnostics,
    buildRendererProcessGoneContext,
    buildWindowUnresponsiveContext,
  };
}

/**
 * 初始化窗口诊断状态，所有字段都来自 main 可读的宿主事实。
 */
function create_window_diagnostics_state(
  target_window: BrowserWindow,
  kind: RendererWindowKind,
): RendererWindowDiagnosticsState {
  const web_contents = target_window.webContents;
  return {
    windowKind: kind,
    webContentsId: web_contents.id,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    lastUrlIdentity: read_web_contents_url_identity(web_contents),
    osProcessId: read_web_contents_os_process_id(web_contents),
    lastRendererDiagnostics: null,
    recentRendererEvents: [],
  };
}

/**
 * 从 webContents 刷新宿主侧可直接读取的运行时字段。
 */
function refresh_window_run_state(
  state: RendererWindowDiagnosticsState,
  web_contents: Electron.WebContents,
): void {
  state.lastSeenAt = new Date().toISOString();
  state.lastUrlIdentity = read_web_contents_url_identity(web_contents);
  state.osProcessId = read_web_contents_os_process_id(web_contents);
}

/**
 * 拼装崩溃和卡死共用窗口上下文，保证两类主进程诊断字段一致。
 */
function build_window_context(
  state: RendererWindowDiagnosticsState,
  web_contents: Electron.WebContents,
): Record<string, unknown> {
  refresh_window_run_state(state, web_contents);
  return {
    windowKind: state.windowKind,
    webContentsId: state.webContentsId,
    createdAt: state.createdAt,
    lastSeenAt: state.lastSeenAt,
    lastUrlIdentity: state.lastUrlIdentity,
    osProcessId: state.osProcessId,
    crashDumpDirectory: summarize_optional_path(read_crash_dump_directory()),
    processMetric: summarize_process_metric(state.osProcessId),
    rendererDiagnostics: state.lastRendererDiagnostics,
    recentRendererEvents: state.recentRendererEvents,
  };
}

/**
 * 读取当前 webContents URL 身份摘要；读取失败时记录空 URL 摘要并继续写主日志。
 */
function read_web_contents_url_identity(web_contents: Electron.WebContents): LogErrorContext {
  try {
    return summarize_log_error_url(web_contents.getURL());
  } catch {
    return summarize_log_error_url("");
  }
}

/**
 * 读取 Chromium 子进程 OS PID，用于和 app metrics、Crashpad 文件互相定位。
 */
function read_web_contents_os_process_id(web_contents: Electron.WebContents): number | null {
  try {
    const pid = web_contents.getOSProcessId();
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * 读取 Electron Crashpad 本地目录；目录不可用时不阻断崩溃日志写入。
 */
function read_crash_dump_directory(): string | null {
  try {
    return app.getPath("crashDumps");
  } catch {
    return null;
  }
}

/**
 * Crashpad 目录也按路径身份摘要写入日志，避免暴露用户目录结构。
 */
function summarize_optional_path(raw_path: string | null): LogErrorContext | null {
  return raw_path === null ? null : summarize_log_error_path(raw_path);
}

/**
 * 只抽取定位性能和内存问题所需的 app metric 字段，避免写入 Electron 内部对象。
 */
function summarize_process_metric(os_process_id: number | null): Record<string, unknown> | null {
  if (os_process_id === null) {
    return null;
  }

  let process_metric: Electron.ProcessMetric | undefined;
  try {
    process_metric = app.getAppMetrics().find((metric) => metric.pid === os_process_id);
  } catch {
    process_metric = undefined;
  }
  if (process_metric === undefined) {
    return null;
  }

  return {
    pid: process_metric.pid,
    type: process_metric.type,
    cpu: {
      percentCPUUsage: process_metric.cpu.percentCPUUsage,
      idleWakeupsPerSecond: process_metric.cpu.idleWakeupsPerSecond,
    },
    memory: {
      workingSetSize: process_metric.memory.workingSetSize,
      peakWorkingSetSize: process_metric.memory.peakWorkingSetSize,
      privateBytes: process_metric.memory.privateBytes,
    },
  };
}
