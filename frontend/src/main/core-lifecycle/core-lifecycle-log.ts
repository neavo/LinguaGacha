const TS_LOG_LEVEL = "TS";
const LOG_LEVEL_COLUMN_WIDTH = 8;

function pad_time_unit(value: number): string {
  return value.toString().padStart(2, "0");
}

export function format_ts_lifecycle_log(message: string, date: Date = new Date()): string {
  const hours = pad_time_unit(date.getHours());
  const minutes = pad_time_unit(date.getMinutes());
  const seconds = pad_time_unit(date.getSeconds());
  const level = TS_LOG_LEVEL.padEnd(LOG_LEVEL_COLUMN_WIDTH, " ");
  return `[${hours}:${minutes}:${seconds}] ${level} ${message}`;
}

export function write_ts_lifecycle_log(message: string): void {
  process.stdout.write(`${format_ts_lifecycle_log(message)}\n`);
}

export function format_core_shutdown_completed_log(
  pid: number | undefined,
  was_force_killed: boolean,
): string {
  const exit_mode = was_force_killed ? "强制关闭" : "优雅退出";
  return `Python Core PID[${pid ?? "unknown"}] 实例${exit_mode} …`;
}

export function format_lifecycle_error(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
