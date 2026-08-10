import process from "node:process";

import { AppError, to_app_error_log_snapshot } from "../../shared/error";
import { try_show_native_error_dialog } from "./native-error-dialog";
import type { BackendRuntimeClient } from "../runtime/backend-runtime-client";

export interface MainFatalErrorHandlerOptions {
  isAppShutdownInProgress: () => boolean;
  quitAfterBackendShutdown: (exitCode: number) => Promise<void>;
  getBackendRuntimeClient: () => Pick<BackendRuntimeClient, "recordHostDiagnostic">;
}

let is_handler_installed = false;
let is_fatal_handling = false;

/**
 * main 入口尽早安装最终兜底，确保逃逸异常在退出前留下 fatal 诊断。
 */
export function install_main_fatal_error_handler(options: MainFatalErrorHandlerOptions): void {
  if (is_handler_installed) {
    return;
  }
  is_handler_installed = true;

  process.on("uncaughtException", (error, origin) => {
    handle_main_fatal_error(error, {
      kind: "uncaughtException",
      origin,
      options,
    });
  });
  process.on("unhandledRejection", (reason) => {
    handle_main_fatal_error(reason, {
      kind: "unhandledRejection",
      origin: "promise",
      options,
    });
  });
}

function handle_main_fatal_error(
  reason: unknown,
  args: {
    kind: "uncaughtException" | "unhandledRejection";
    origin: string;
    options: MainFatalErrorHandlerOptions;
  },
): void {
  if (is_fatal_handling) {
    try_write_fatal_stderr(`[fatal] duplicate ${args.kind}: ${format_unknown_reason(reason)}\n`);
    process.exit(1);
  }
  is_fatal_handling = true;

  const error =
    reason instanceof AppError
      ? reason
      : new AppError("runtime.internal_invariant", { cause: reason });
  const context = {
    kind: args.kind,
    origin: args.origin,
    is_app_shutdown_in_progress: args.options.isAppShutdownInProgress(),
  };
  const snapshot = to_app_error_log_snapshot(error, { fatal: true, context });
  try_show_native_error_dialog("LinguaGacha 已遇到致命错误", "已写入诊断日志，应用将退出。");

  // fatal 诊断必须先进入 worker 日志，再启动同一 worker 的关闭流程，避免并发 stop 丢日志。
  void (async () => {
    try {
      await args.options.getBackendRuntimeClient().recordHostDiagnostic({
        level: "fatal",
        messageKey: "app.diagnostic.lifecycle.main_fatal_uncaught",
        error: snapshot.error,
      });
    } catch (diagnostic_error) {
      try_write_fatal_stderr(
        `[fatal] ${args.kind}: ${format_unknown_reason(reason)}\n[fatal] diagnostic: ${format_unknown_reason(diagnostic_error)}\n`,
      );
    }
    await args.options.quitAfterBackendShutdown(1).catch(() => process.exit(1));
  })();
}

/**
 * fatal 诊断只能尽力写 stderr，输出失败也不能阻断 Backend 关闭入口。
 */
function try_write_fatal_stderr(text: string): void {
  try {
    process.stderr.write(text);
  } catch {
    // fatal 路径没有更低层的可靠日志目标，继续进入统一关闭比再次抛错更重要。
  }
}

function format_unknown_reason(reason: unknown): string {
  return reason instanceof Error
    ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
    : String(reason);
}
