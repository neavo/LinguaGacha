import process from "node:process";

import type { LogManager } from "./log-manager";
import { format_console_log } from "./log-console-formatter";
import type { LogAppendPayload, LogLevel } from "../../shared/log";
import {
  error_diagnostic_to_log_fields,
  sanitize_error_diagnostic_context,
  to_error_diagnostic,
} from "../../shared/error";

let active_log_manager: LogManager | null = null;

/**
 * 主进程启动链路把当前日志权威登记到这里，供 Electron 事件回调用同一实例
 */
export function set_electron_main_log_manager(log_manager: LogManager | null): void {
  active_log_manager = log_manager;
}

// get_electron_main_log_manager 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function get_electron_main_log_manager(): LogManager | null {
  return active_log_manager;
}

// write_electron_main_warning 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function write_electron_main_warning(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  const normalized = normalize_log_error_payload(payload);
  if (log_manager === null) {
    write_fallback_console_log("warning", message, normalized);
    return;
  }
  log_manager.warning(message, {
    source: "electron-main",
    ...normalized,
  });
}

// write_electron_main_debug 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function write_electron_main_debug(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  const normalized = normalize_log_error_payload(payload);
  if (log_manager === null) {
    write_fallback_console_log("debug", message, normalized);
    return;
  }
  log_manager.debug(message, {
    source: "electron-main",
    ...normalized,
  });
}

// write_electron_main_error 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function write_electron_main_error(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  const normalized = normalize_log_error_payload(payload);
  if (log_manager === null) {
    write_fallback_console_log("error", message, normalized);
    return;
  }
  log_manager.error(message, {
    source: "electron-main",
    ...normalized,
  });
}

// normalize_log_error_payload 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_log_error_payload(payload: {
  error?: unknown;
  context?: Record<string, unknown>;
}): {
  error_message?: string;
  stack?: string;
  context?: Record<string, unknown>;
} {
  const context =
    payload.context === undefined ? undefined : sanitize_error_diagnostic_context(payload.context);
  if (payload.error === undefined) {
    return context === undefined || Object.keys(context).length === 0 ? {} : { context };
  }
  return error_diagnostic_to_log_fields(to_error_diagnostic(payload.error, context ?? {}));
}

// write_fallback_console_log 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function write_fallback_console_log(
  level: Extract<LogLevel, "debug" | "warning" | "error">,
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
