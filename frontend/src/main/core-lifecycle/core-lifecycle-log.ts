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

export function format_lifecycle_error(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
