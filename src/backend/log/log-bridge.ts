import process from "node:process";

import type { LogManager } from "./log-manager";
import { format_console_log } from "./log-console-formatter";
import type { LogLevel } from "../../shared/log";
import { to_log_error, type LogError } from "../../shared/error";

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
  if (log_manager === null) {
    write_fallback_console_log("warning", message, payload);
    return;
  }
  log_manager.warning(message, {
    source: "electron-main",
    ...payload,
  });
}

// write_electron_main_debug 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function write_electron_main_debug(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  if (log_manager === null) {
    write_fallback_console_log("debug", message, payload);
    return;
  }
  log_manager.debug(message, {
    source: "electron-main",
    ...payload,
  });
}

// write_electron_main_error 封装当前模块的共享逻辑，避免重复实现同一维护规则。
export function write_electron_main_error(
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> } = {},
): void {
  const log_manager = get_electron_main_log_manager();
  if (log_manager === null) {
    write_fallback_console_log("error", message, payload);
    return;
  }
  log_manager.error(message, {
    source: "electron-main",
    ...payload,
  });
}

// write_fallback_console_log 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function write_fallback_console_log(
  level: Extract<LogLevel, "debug" | "warning" | "error">,
  message: string,
  payload: { error?: unknown; context?: Record<string, unknown> },
): void {
  const normalized_error = normalize_fallback_error(payload);
  const text = format_console_log(
    {
      level,
      message,
      ...(normalized_error === undefined ? {} : { error: normalized_error }),
    },
    new Date(),
  );
  if (level === "error") {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }
}

// normalize_fallback_error 保持无 LogManager 时的控制台输出与正式写入口一致。
function normalize_fallback_error(payload: {
  error?: unknown;
  context?: Record<string, unknown>;
}): LogError | undefined {
  if (payload.error !== undefined) {
    return to_log_error(payload.error, payload.context ?? {});
  }
  return undefined;
}
