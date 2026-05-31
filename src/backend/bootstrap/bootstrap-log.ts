import { get_electron_main_log_manager } from "../log/log-bridge";
import { to_log_error, type LogError } from "../../shared/error";

// MAIN LOG LEVEL 是模块级稳定契约，集中维护避免调用点散落魔术值。
const MAIN_LOG_LEVEL = "MAIN";
// LOG LEVEL COLUMN WIDTH 是运行时节流或容量阈值，集中保存便于评估性能影响。
const LOG_LEVEL_COLUMN_WIDTH = 8;

function pad_time_unit(value: number): string {
  return value.toString().padStart(2, "0");
}

// 统一生成日志或 UI 展示文本，避免多处拼接造成口径漂移。
export function format_bootstrap_log(message: string, date: Date = new Date()): string {
  const hours = pad_time_unit(date.getHours());
  const minutes = pad_time_unit(date.getMinutes());
  const seconds = pad_time_unit(date.getSeconds());
  const level = MAIN_LOG_LEVEL.padEnd(LOG_LEVEL_COLUMN_WIDTH, " ");
  return `[${hours}:${minutes}:${seconds}] ${level} ${message}`;
}

export function write_bootstrap_log(message: string): void {
  const log_manager = get_electron_main_log_manager();
  if (log_manager === null) {
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
): void {
  const log_manager = get_electron_main_log_manager();
  const log_error =
    payload.logError ?? (payload.error === undefined ? null : to_log_error(payload.error));
  if (log_manager === null) {
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
