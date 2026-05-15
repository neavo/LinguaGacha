import {
  to_app_error_log_projection,
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
 * main 侧统一把 AppError 写入 LogManager，避免各边界手拼 code/details/stack。
 */
export function record_app_error(error: AppError, options: RecordAppErrorOptions): void {
  const projection = to_app_error_log_projection(error, {
    context: options.context,
    fatal: options.fatal,
  });
  const payload = {
    source: options.source,
    context: projection.context,
    error_message: projection.error_message,
    stack: projection.stack,
  };

  switch (projection.level) {
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
