import process from "node:process";

import type { LogManager } from "./log-manager";
import { format_console_log } from "./log-console-formatter";
import type { LogAppendPayload, LogLevel } from "../../shared/log";

let active_log_manager: LogManager | null = null;

/**
 * 主进程启动链路把当前日志权威登记到这里，供 Electron 事件回调用同一实例
 */
export function set_electron_main_log_manager(log_manager: LogManager | null): void {
  active_log_manager = log_manager;
}

export function get_electron_main_log_manager(): LogManager | null {
  return active_log_manager;
}

export function write_electron_main_warning(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  const normalized = normalize_error_payload(payload.error);
  if (log_manager === null) {
    write_fallback_console_log("warning", message, normalized);
    return;
  }
  log_manager.warning(message, {
    source: "electron-main",
    context: payload.context,
    error_message: normalized.error_message,
    stack: normalized.stack,
  });
}

export function write_electron_main_error(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  const normalized = normalize_error_payload(payload.error);
  if (log_manager === null) {
    write_fallback_console_log("error", message, normalized);
    return;
  }
  log_manager.error(message, {
    source: "electron-main",
    context: payload.context,
    error_message: normalized.error_message,
    stack: normalized.stack,
  });
}

function normalize_error_payload(error: unknown): {
  error_message?: string;
  stack?: string;
} {
  if (error === undefined) {
    return {};
  }
  if (error instanceof Error) {
    return {
      error_message: error.message,
      stack: error.stack,
    };
  }
  return {
    error_message: String(error),
  };
}

function write_fallback_console_log(
  level: Extract<LogLevel, "warning" | "error">,
  message: string,
  normalized: { error_message?: string; stack?: string },
): void {
  const payload: LogAppendPayload = {
    level,
    message,
    source: "electron-main",
    error_message: normalized.error_message,
    stack: normalized.stack,
  };
  const text = format_console_log(payload, new Date());
  if (level === "error") {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }
}
