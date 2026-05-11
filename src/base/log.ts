// 日志等级同时进入 main 日志、SSE payload 和日志窗口筛选。
export const LOG_LEVELS = ["debug", "info", "warning", "error", "fatal"] as const;

// worker 回放到用户可见任务日志时只允许这三个等级。
export const TASK_VISIBLE_LOG_LEVELS = ["info", "warning", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type TaskVisibleLogLevel = (typeof TASK_VISIBLE_LOG_LEVELS)[number];

const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);
const TASK_VISIBLE_LOG_LEVEL_SET = new Set<TaskVisibleLogLevel>(TASK_VISIBLE_LOG_LEVELS);

// 边界反序列化先用判定函数收窄，避免未知日志等级进入 UI 筛选。
export function is_log_level(value: unknown): value is LogLevel {
  return LOG_LEVEL_SET.has(value as LogLevel);
}

// 旧配置或外部 payload 的未知日志等级统一降级为 info。
export function normalize_log_level(value: unknown): LogLevel {
  return is_log_level(value) ? value : "info";
}

// 任务日志只允许用户可见等级，worker 内部 debug/fatal 不直接穿透。
export function is_task_visible_log_level(value: unknown): value is TaskVisibleLogLevel {
  return TASK_VISIBLE_LOG_LEVEL_SET.has(value as TaskVisibleLogLevel);
}
