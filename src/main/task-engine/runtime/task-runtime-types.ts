import type { ApiJsonValue } from "../../api/api-types";
export { TASK_TYPES, is_task_type, type TaskType } from "../../../shared/task";

export type JsonRecord = Record<string, ApiJsonValue>;

export type MutableJsonRecord = Record<string, ApiJsonValue>;

/**
 * TaskRuntimeState 只描述实时任务事实，不携带公开进度快照。
 */
export interface TaskRuntimeStatePayload {
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
