import { to_log_error, type LogError } from "../../shared/error";
import type { LogManager } from "../log/log-manager";

const MAIN_LOG_LEVEL = "MAIN";
const LOG_LEVEL_COLUMN_WIDTH = 8; // 与其它控制台日志等级列保持固定对齐

function pad_time_unit(value: number): string {
  return value.toString().padStart(2, "0");
}

/** 生成 LogManager 尚未可用时的启动期控制台行。 */
export function format_bootstrap_log(message: string, date: Date = new Date()): string {
  const hours = pad_time_unit(date.getHours());
  const minutes = pad_time_unit(date.getMinutes());
  const seconds = pad_time_unit(date.getSeconds());
  const level = MAIN_LOG_LEVEL.padEnd(LOG_LEVEL_COLUMN_WIDTH, " ");
  return `[${hours}:${minutes}:${seconds}] ${level} ${message}`;
}

/** 优先写入结构化日志；启动最早期才使用 stdout。 */
export function write_bootstrap_log(message: string, log_manager?: Pick<LogManager, "info">): void {
  if (log_manager === undefined) {
    process.stdout.write(`${format_bootstrap_log(message)}\n`);
    return;
  }
  log_manager.info(message, { source: "backend-bootstrap" });
}

/**
 * 启动期错误在 LogManager 就绪后保持结构化，未就绪时才退回纯 stderr。
 */
export function write_bootstrap_error(
  message: string,
  payload: { error?: unknown; logError?: LogError } = {},
  log_manager?: Pick<LogManager, "error">,
): void {
  const log_error =
    payload.logError ?? (payload.error === undefined ? null : to_log_error(payload.error));
  if (log_manager === undefined) {
    const suffix =
      log_error === null
        ? ""
        : `\n${log_error.message}${log_error.stack === undefined ? "" : `\n${log_error.stack}`}`;
    process.stderr.write(`${format_bootstrap_log(`${message}${suffix}`)}\n`);
    return;
  }
  log_manager.error(message, {
    source: "backend-bootstrap",
    ...(log_error === null ? {} : { error: log_error }),
  });
}
