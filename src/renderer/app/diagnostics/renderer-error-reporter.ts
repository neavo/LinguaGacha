import { report_renderer_error } from "@/app/desktop/desktop-api";
import {
  create_renderer_error_report,
  normalize_renderer_diagnostics_payload,
  type ErrorDiagnosticContextInput,
  type ErrorDiagnosticPayload,
  type RendererDiagnosticsContext,
  type RendererDiagnosticsPayload,
  type RendererErrorContextInput,
  type RendererErrorReport,
} from "@shared/error";

export type RendererErrorSource =
  | "global"
  | "render"
  | "sse"
  | "project-mutation"
  | "settings"
  | "scheduler"
  | "runtime-recovery"
  | "page-cache"
  | "worker";

export type RendererErrorCaptureOptions = {
  source: RendererErrorSource; // source 表示 renderer 内部错误来源
  diagnostic?: ErrorDiagnosticPayload; // diagnostic 允许 worker 等边界传入既有结构化错误快照
  triggeringEvent?: ErrorDiagnosticContextInput; // triggeringEvent 记录导致异常的事件头
  context?: RendererErrorContextInput; // context 只允许 renderer error 白名单字段
  dedupeKey?: string; // dedupeKey 用于调用点覆盖默认去重签名
};

// RECENT ERROR TTL MS 是模块级稳定契约，集中维护避免调用点散落魔术值。
const RECENT_ERROR_TTL_MS = 1000;
// RECENT ERROR LIMIT 是运行时节流或容量阈值，集中保存便于评估性能影响。
const RECENT_ERROR_LIMIT = 16;

let diagnostics_context: RendererDiagnosticsContext = {};
const recent_error_signatures: Array<{ signature: string; capturedAt: number }> = [];

/**
 * 运行态持续刷新诊断上下文，真正抛错时才把当前快照随错误一起写入日志。
 */
export function update_renderer_diagnostics_context(context: RendererDiagnosticsContext): void {
  const normalized_context = normalize_renderer_diagnostics_payload(context);
  diagnostics_context = pick_renderer_diagnostics_context(normalized_context);
  report_renderer_diagnostics_to_main(diagnostics_context);
}

/**
 * 记录运行态关键事件面包屑，给原生 renderer 崩溃日志补齐最后的业务触发点。
 */
export function record_renderer_diagnostics_event(event: ErrorDiagnosticContextInput): void {
  report_renderer_diagnostics_to_main(normalize_renderer_diagnostics_payload({ event }));
}

/**
 * 捕获 renderer 实际异常并异步写入 Core 日志；诊断失败不能反向影响页面运行。
 */
export function capture_renderer_error(error: unknown, options: RendererErrorCaptureOptions): void {
  const report = create_renderer_error_report({
    source: options.source,
    error,
    diagnostic: options.diagnostic,
    diagnosticsContext: diagnostics_context,
    triggeringEvent: options.triggeringEvent,
    context: options.context,
  });
  const signature = options.dedupeKey ?? build_error_signature(report);
  if (is_recent_error_signature(signature)) {
    return;
  }

  // 诊断写入失败不能再次进入诊断链路，否则网络/日志故障会放大成递归异常。
  void report_renderer_error(report).catch(() => undefined);
}

/**
 * 根入口注册浏览器级异常监听，覆盖 React 边界之外的未处理 promise 和事件回调错误。
 */
export function install_renderer_global_error_handlers(): () => void {
  // handle_error 是事件处理边界，只把外部事件转换为本模块状态更新。
  function handle_error(event: ErrorEvent): void {
    capture_renderer_error(event.error ?? event.message, {
      source: "global",
      context: {
        eventKind: "error",
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        location: window.location.href,
      },
    });
  }

  // handle_unhandled_rejection 是事件处理边界，只把外部事件转换为本模块状态更新。
  function handle_unhandled_rejection(event: PromiseRejectionEvent): void {
    capture_renderer_error(event.reason, {
      source: "global",
      context: {
        eventKind: "unhandledrejection",
        location: window.location.href,
      },
    });
  }

  window.addEventListener("error", handle_error);
  window.addEventListener("unhandledrejection", handle_unhandled_rejection);
  return () => {
    window.removeEventListener("error", handle_error);
    window.removeEventListener("unhandledrejection", handle_unhandled_rejection);
  };
}

// build_error_signature 构造跨层载荷，保证字段形状在一个入口维护。
function build_error_signature(report: RendererErrorReport): string {
  const stack_head = report.diagnostic.stack?.split("\n").slice(0, 3).join("\n") ?? "";
  return [report.source, report.diagnostic.message, stack_head, report.route ?? ""].join("|");
}

// is_recent_error_signature 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_recent_error_signature(signature: string): boolean {
  const now = Date.now();
  while (
    recent_error_signatures.length > 0 &&
    now - (recent_error_signatures[0]?.capturedAt ?? now) > RECENT_ERROR_TTL_MS
  ) {
    recent_error_signatures.shift();
  }
  if (recent_error_signatures.some((entry) => entry.signature === signature)) {
    return true;
  }

  recent_error_signatures.push({ signature, capturedAt: now });
  while (recent_error_signatures.length > RECENT_ERROR_LIMIT) {
    recent_error_signatures.shift();
  }
  return false;
}

// pick_renderer_diagnostics_context 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function pick_renderer_diagnostics_context(
  payload: RendererDiagnosticsPayload,
): RendererDiagnosticsContext {
  return {
    ...(payload.route === undefined ? {} : { route: payload.route }),
    ...(payload.project === undefined ? {} : { project: payload.project }),
    ...(payload.task === undefined ? {} : { task: payload.task }),
  };
}

/**
 * main 侧黑匣子只是进程级崩溃诊断增强，调用失败时不能影响 JS 异常主上报。
 */
function report_renderer_diagnostics_to_main(payload: RendererDiagnosticsPayload): void {
  try {
    const desktop_app = (
      window as Window & {
        desktopApp?: {
          reportRendererDiagnostics?: (payload: RendererDiagnosticsPayload) => void;
        };
      }
    ).desktopApp;
    desktop_app?.reportRendererDiagnostics?.(payload);
  } catch {
    // main 侧黑匣子只是诊断增强，失败不能影响 renderer 正常运行或错误上报主链路。
  }
}
