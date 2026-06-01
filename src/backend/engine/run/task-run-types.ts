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
 * TaskRunState 只描述实时任务事实，不携带公开进度快照
 */
export interface TaskRunStateSnapshot {
  run_revision: number; // 后端任务 snapshot 的唯一单调排序字段
  status: import("../../../domain/task").TaskRunStatus; // Engine 运行态唯一状态机值
  busy: boolean; // 同步写入与任务按钮共同使用的全局互斥事实
  request_in_flight_count: number; // 真实发出的请求数，不等于队列长度
  active_task_type: string; // 优先决定公开 snapshot 的 task_type
  translation_scope: TranslationScope; // 普通翻译与重翻行级状态的唯一来源
}
