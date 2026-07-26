import process from "node:process";

import type { LogManager } from "./log-manager";
import { format_console_log } from "./log-console-formatter";
import type { LogLevel } from "../../shared/log";
import { to_log_error, type LogError } from "../../shared/error";

let active_log_manager: LogManager | null = null; // Electron main 当前日志权威；启动前和关闭后为 null

/**
 * 主进程启动链路把当前日志权威登记到这里，供 Electron 事件回调用同一实例
 */
export function set_electron_main_log_manager(log_manager: LogManager | null): void {
  active_log_manager = log_manager;
}

/**
 * Electron 回调按需读取当前日志实例，避免闭包持有已关闭的 manager。
 */
export function get_electron_main_log_manager(): LogManager | null {
  return active_log_manager;
}

/**
 * 主进程 warning 优先写正式日志；初始化前回退 stdout，保证启动诊断可见。
 */
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

/**
 * 主进程 error 优先写正式日志；初始化前回退 stderr 并保留结构化错误。
 */
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

/**
 * 无 LogManager 时仍复用正式控制台格式，错误级别固定走 stderr。
 */
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

// 保持无 LogManager 时的控制台输出与正式写入口一致。
function normalize_fallback_error(payload: {
  error?: unknown;
  context?: Record<string, unknown>;
}): LogError | undefined {
  if (payload.error !== undefined) {
    return to_log_error(payload.error, payload.context ?? {});
  }
  return undefined;
}
