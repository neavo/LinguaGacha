import type { TranslationScope } from "../../../domain/task";
export {
  TASK_RUN_STATUSES,
  TASK_TYPES,
  is_task_run_status,
  is_task_type,
  normalize_task_type,
  type TaskRunStatus,
  type TaskType,
} from "../../../domain/task";
export type { JsonRecord, MutableJsonRecord } from "../protocol/json";

/**
 * TaskRuntimeState 只描述实时任务事实，不携带公开进度快照
 */
export interface TaskRuntimeStatePayload {
  runtime_revision: number; // runtime_revision 是后端任务 snapshot 的唯一单调排序字段
  status: import("../../../domain/task").TaskRunStatus; // status 是 Engine 运行态唯一状态机值
  busy: boolean; // busy 是同步 mutation 与任务按钮共同使用的全局互斥事实
  request_in_flight_count: number; // request_in_flight_count 表示真实发出的请求数，不等于队列长度
  active_task_type: string; // active_task_type 优先决定公开 snapshot 的 task_type
  translation_scope: TranslationScope; // translation_scope 是普通翻译与重翻行级状态的唯一来源
}
