import process from "node:process";

import { AppError, InternalInvariantError } from "../../shared/error";
import { try_show_native_error_dialog } from "../../native/shell/native-error-dialog";
import { get_electron_main_log_manager } from "../log/log-bridge";
import { record_app_error } from "../log/app-error-reporter";
import { t_main_log } from "../log/log-text";

export interface MainFatalErrorHandlerOptions {
  isAppShutdownInProgress: () => boolean;
  quitAfterCoreShutdown: (exitCode: number) => Promise<void>;
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
    process.stderr.write(`[fatal] duplicate ${args.kind}: ${format_unknown_reason(reason)}\n`);
    process.exit(1);
  }
  is_fatal_handling = true;

  const error = reason instanceof AppError ? reason : new InternalInvariantError({ cause: reason });
  const context = {
    kind: args.kind,
    origin: args.origin,
    is_app_shutdown_in_progress: args.options.isAppShutdownInProgress(),
  };
  const log_manager = get_electron_main_log_manager();
  if (log_manager === null) {
    process.stderr.write(`[fatal] ${args.kind}: ${format_unknown_reason(reason)}\n`);
  } else {
    record_app_error(error, {
      logManager: log_manager,
      message: t_main_log("app.diagnostic.lifecycle.main_fatal_uncaught"),
      source: "electron-main",
      context,
      fatal: true,
    });
  }

  try_show_native_error_dialog("LinguaGacha 已遇到致命错误", "已写入诊断日志，应用将退出。");

  void args.options.quitAfterCoreShutdown(1).catch(() => {
    process.exit(1);
  });
}

function format_unknown_reason(reason: unknown): string {
  return reason instanceof Error
    ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
    : String(reason);
}
