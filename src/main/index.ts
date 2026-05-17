import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { register_desktop_ipc_handlers } from "../native/shell/desktop-ipc-host";
import {
  configure_development_remote_debugging,
  configure_renderer_public_path,
  create_log_window_host,
  create_main_window,
} from "../native/shell/desktop-window-host";
import { show_native_error_dialog } from "../native/shell/native-error-dialog";
import { CoreLifecycleManager } from "./lifecycle/lifecycle-manager";
import { install_main_fatal_error_handler } from "./lifecycle/main-fatal-error-handler";
import { type LogWindowHost } from "../native/shell/log-window-host";
import { write_electron_main_error } from "./log/log-bridge";
import { t_main_log } from "./log/log-text";
import * as AppErrors from "../shared/error";

const desktop_bundle_dir = path.dirname(fileURLToPath(import.meta.url)); // Electron ESM 入口没有 CommonJS 的 __dirname，这里只用于定位已构建的前端资源

configure_renderer_public_path(desktop_bundle_dir);
configure_development_remote_debugging();

let win: BrowserWindow | null = null; // 主窗口是桌面宿主的唯一工作台窗口，关闭后引用必须归零，避免 IPC 误用失效窗口
let log_window_host: LogWindowHost | null = null; // 日志窗口由独立宿主管理，避免主窗口生命周期和日志诊断窗口互相持有复杂状态
let core_api_base_url: string | null = null; // Core API 地址由生命周期启动结果注入窗口，preload 不再猜测固定端口或读取环境兜底
let is_app_shutdown_in_progress = false; // 退出流程只允许进入一次，防止 before-quit、后端异常和窗口关闭同时触发重复清理
let is_renderer_confirmed_app_quit = false; // renderer 已确认退出时，主窗口 close 事件不再反向弹出网页确认流程

// 后端生命周期必须先于 renderer 启动，保证桌面 API 暴露时公开 Gateway 已可用
const core_lifecycle_manager = new CoreLifecycleManager({
  appRoot: app.isPackaged ? path.dirname(process.execPath) : process.cwd(),
  openOutputFolder: open_output_folder,
  onUnexpectedExit: (result) => {
    const exit_code_text = result.exitCode === null ? "null" : result.exitCode.toString(); // 兼容迁移窗口的异常回调；触发时仍直接走同一条退出清理路径
    const signal_text = result.signal === null ? "null" : result.signal;
    show_native_error_dialog(
      "后端服务异常退出",
      `后端服务已提前退出，应用将关闭。\n退出码：${exit_code_text}\n信号：${signal_text}`,
    );
    void quit_app_after_core_shutdown(1);
  },
});

install_main_fatal_error_handler({
  isAppShutdownInProgress: () => is_app_shutdown_in_progress,
  quitAfterCoreShutdown: quit_app_after_core_shutdown,
});

/**
 * 输出目录只由导出成功链路触发，Electron shell 返回非空错误文本时转为异常交给文件域记录
 */
async function open_output_folder(output_path: string): Promise<void> {
  const error_message = await shell.openPath(output_path);
  if (error_message !== "") {
    throw new AppErrors.FileIoFailedError({
      diagnostic_context: { output_path, reason: error_message },
    });
  }
}

/**
 * 创建主工作台窗口，并把窗口关闭后的跨宿主联动留在入口层
 */
function create_main_window_for_runtime(): void {
  win = create_main_window({
    desktopBundleDir: desktop_bundle_dir,
    coreApiBaseUrl: require_core_api_base_url(),
    shouldBypassCloseConfirmation: () => {
      return is_app_shutdown_in_progress || is_renderer_confirmed_app_quit;
    },
    onClosed: () => {
      win = null;
      log_window_host?.close();
    },
  });
}

/**
 * 窗口只能在 Core 生命周期 ready 后创建，避免 preload 暴露不可用的 API 地址
 */
function require_core_api_base_url(): string {
  if (core_api_base_url === null) {
    throw new AppErrors.InternalInvariantError({
      diagnostic_context: { reason: "core_api_base_url_not_ready" },
    });
  }

  return core_api_base_url;
}

/**
 * 注册 renderer 可调用的桌面宿主桥接能力
 */
function register_runtime_ipc_handlers(read_app_language: () => unknown): void {
  register_desktop_ipc_handlers({
    getMainWindow: () => {
      return win;
    },
    getLogWindowHost: () => {
      return log_window_host;
    },
    markRendererConfirmedAppQuit: () => {
      is_renderer_confirmed_app_quit = true;
    },
    readAppLanguage: read_app_language,
  });
}

/**
 * 退出前先关闭后端生命周期，确保 Gateway、ProjectDatabase 和日志系统按顺序收尾
 */
async function quit_app_after_core_shutdown(exit_code: number): Promise<void> {
  if (is_app_shutdown_in_progress) {
    return;
  }

  is_app_shutdown_in_progress = true;
  try {
    await core_lifecycle_manager.stop();
  } finally {
    app.exit(exit_code);
  }
}

// 所有窗口关闭时进入应用退出；日志窗口也要一起收掉，避免诊断窗口单独存活
app.on("window-all-closed", () => {
  win = null;
  log_window_host?.close();
  app.quit();
});

// Electron 原生退出前拦截一次，用统一 Core 收尾路径替代直接退出
app.on("before-quit", (event) => {
  if (core_lifecycle_manager.isStopped()) {
    return;
  }

  event.preventDefault();
  void quit_app_after_core_shutdown(0);
});

// macOS Dock 激活事件只负责恢复工作台窗口，不应在退出流程中重新建窗
app.on("activate", () => {
  if (!is_app_shutdown_in_progress && BrowserWindow.getAllWindows().length === 0) {
    create_main_window_for_runtime();
  }
});

// Electron ready 后才能启动后端和创建窗口，保证 app API 与原生资源都已可用
app.whenReady().then(async () => {
  try {
    const core_start_result = await core_lifecycle_manager.start();
    core_api_base_url = core_start_result.baseUrl;
    log_window_host = create_log_window_host({
      desktopBundleDir: desktop_bundle_dir,
      coreApiBaseUrl: core_start_result.baseUrl,
    });
    register_runtime_ipc_handlers(core_start_result.readAppLanguage);
    create_main_window_for_runtime();
  } catch (error) {
    write_electron_main_error(t_main_log("app.diagnostic.lifecycle.app_start_failed"), { error });
    const message = error instanceof Error ? error.message : "后端服务启动失败。";
    show_native_error_dialog("LinguaGacha 启动失败", message);
    app.exit(1);
  }
});
