export const LOG_LEVELS = ["debug", "info", "warning", "error", "fatal"] as const; // 日志等级同时进入 main 日志、SSE payload 和日志窗口筛选

export const TASK_VISIBLE_LOG_LEVELS = ["info", "warning", "error"] as const; // worker 回放到用户可见任务日志时只允许这三个等级

export const LOG_WINDOW_EVENT_CAPACITY = 8 * 1024; // main replay、详情池与 renderer 日志窗口共享同一实时保留上限

export const LOG_WINDOW_MESSAGE_PREVIEW_LENGTH = 1024; // 日志列表只消费预览，完整正文按需从后端详情池读取

export type LogLevel = (typeof LOG_LEVELS)[number];
export type TaskVisibleLogLevel = (typeof TASK_VISIBLE_LOG_LEVELS)[number];

export interface LogTargets {
  file: boolean; // 写入日志文件
  console: boolean; // 输出到控制台
  window: boolean; // 推送到日志窗口和 SSE 订阅者
}

export interface LogEvent {
  id: string; // 单条日志事件 ID
  sequence: number; // 进程内递增序号
  created_at: string; // ISO 时间戳
  level: LogLevel; // 公开日志等级
  source: string; // 产生日志的模块或任务源
  message_preview: string; // 已格式化日志正文预览，供列表、筛选和 SSE 使用
  message_length: number; // 完整正文字符数，供 UI 判断详情体量
}

export interface LogDetail {
  id: string; // 与 LogEvent.id 一一对应
  sequence: number; // 与轻量事件共享的进程内序号
  created_at: string; // 与轻量事件共享的创建时间
  level: LogLevel; // 与轻量事件共享的日志等级
  source: string; // 产生日志的模块或任务源
  message: string; // 完整日志正文，只通过详情接口按需读取
  error_message?: string; // Error.message 的边界快照
  stack?: string; // Error.stack 的边界快照
  context?: Record<string, unknown>; // 额外结构化上下文
}

export interface LogAppendPayload {
  level: LogLevel; // 写入等级
  message: string; // 原始日志正文
  source?: string; // 产生日志的模块或任务源
  error_message?: string; // Error.message 的边界快照
  stack?: string; // Error.stack 的边界快照
  context?: Record<string, unknown>; // 额外结构化上下文
  targets?: Partial<LogTargets>; // 单次写入的输出目标覆盖
}

export type LogSubscriber = (event: LogEvent) => void;

const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);
const TASK_VISIBLE_LOG_LEVEL_SET = new Set<TaskVisibleLogLevel>(TASK_VISIBLE_LOG_LEVELS);

// 边界反序列化先用判定函数收窄，避免未知日志等级进入 UI 筛选
export function is_log_level(value: unknown): value is LogLevel {
  return LOG_LEVEL_SET.has(value as LogLevel);
}

// 旧配置或外部 payload 的未知日志等级统一降级为 info
export function normalize_log_level(value: unknown): LogLevel {
  return is_log_level(value) ? value : "info";
}

// 任务日志只允许用户可见等级，worker 内部 debug/fatal 不直接穿透
export function is_task_visible_log_level(value: unknown): value is TaskVisibleLogLevel {
  return TASK_VISIBLE_LOG_LEVEL_SET.has(value as TaskVisibleLogLevel);
}
