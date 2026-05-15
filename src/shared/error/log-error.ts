import type { LogLevel } from "../log";
import type { AppError, AppErrorDiagnosticContext } from "./app-error";

export interface AppErrorLogProjection {
  level: Extract<LogLevel, "debug" | "warning" | "error" | "fatal">;
  error_message: string;
  stack?: string;
  context: AppErrorDiagnosticContext;
}

export interface AppErrorLogProjectionOptions {
  fatal?: boolean;
  context?: AppErrorDiagnosticContext;
}

/**
 * 日志投影保留诊断上下文和 cause 链，但不依赖 main 侧 LogManager 实例。
 */
export function to_app_error_log_projection(
  error: AppError,
  options: AppErrorLogProjectionOptions = {},
): AppErrorLogProjection {
  const cause_chain = collect_error_cause_chain(error);
  return {
    level: options.fatal === true ? "fatal" : resolve_app_error_log_level(error),
    error_message: error.message,
    stack: error.stack,
    context: {
      code: error.code,
      severity: error.severity,
      public_details: error.public_details,
      diagnostic_context: error.diagnostic_context,
      cause_chain,
      ...options.context,
    },
  };
}

function resolve_app_error_log_level(
  error: AppError,
): Extract<LogLevel, "debug" | "warning" | "error"> {
  switch (error.severity) {
    case "expected":
      return "debug";
    case "warning":
      return "warning";
    case "fault":
      return "error";
  }
}

function collect_error_cause_chain(error: Error): Array<Record<string, string>> {
  const chain: Array<Record<string, string>> = [];
  let current: unknown = error.cause;
  while (current !== undefined && current !== null && chain.length < 8) {
    if (current instanceof Error) {
      chain.push({
        name: current.name,
        message: current.message,
        ...(current.stack === undefined ? {} : { stack: current.stack }),
      });
      current = current.cause;
      continue;
    }
    chain.push({ name: typeof current, message: String(current) });
    break;
  }
  return chain;
}
