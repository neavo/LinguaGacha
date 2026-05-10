import type { ApiJsonValue } from "../api/api-types";

// 公开任务类型固定为三类，TS Gateway 和内部 Engine bridge 都只传这些字符串。
export const TASK_TYPES = ["translation", "analysis", "retranslate"] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type JsonRecord = Record<string, ApiJsonValue>;

export type MutableJsonRecord = Record<string, ApiJsonValue>;

/**
 * TS TaskRuntimeState 只描述实时任务事实，不携带公开进度快照。
 */
export interface TaskEngineStatePayload {
  // status 是 Engine 原始状态字符串，公开快照直接透传这个稳定语义。
  status: string;
  // busy 是同步 mutation 与任务按钮共同使用的全局互斥事实。
  busy: boolean;
  // request_in_flight_count 表示真实发出的请求数，不等于队列长度。
  request_in_flight_count: number;
  // active_task_type 优先决定公开 snapshot 的 task_type。
  active_task_type: string;
  // 重翻条目 id 属于 Engine 运行态，不落入 ProjectStore 其它 section。
  retranslating_item_ids: number[];
}

/**
 * 判断公开任务类型，避免路由层把任意字符串透到 Engine 语义里。
 */
export function is_task_type(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}
