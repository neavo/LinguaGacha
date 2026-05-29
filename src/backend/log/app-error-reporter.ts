import {
  to_app_error_log_snapshot,
  type AppError,
  type AppErrorDiagnosticContext,
} from "../../shared/error";
import type { LogManager } from "./log-manager";

export interface RecordAppErrorOptions {
  logManager: LogManager;
  message: string;
  source: string;
  context?: AppErrorDiagnosticContext;
  fatal?: boolean;
}

/**
 * Backend 侧统一把 AppError 写入 LogManager，避免各边界手拼 code/details/stack。
 */
export function record_app_error(error: AppError, options: RecordAppErrorOptions): void {
  const snapshot = to_app_error_log_snapshot(error, {
    context: options.context,
    fatal: options.fatal,
  });
  const payload = {
    source: options.source,
    error: snapshot.error,
  };

  switch (snapshot.level) {
    case "debug":
      options.logManager.debug(options.message, payload);
      return;
    case "warning":
      options.logManager.warning(options.message, payload);
      return;
    case "error":
      options.logManager.error(options.message, payload);
      return;
    case "fatal":
      options.logManager.fatal(options.message, payload);
      return;
  }
}
