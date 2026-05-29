import type { ApiJsonValue } from "../../api/api-types";
import type { TaskRunStatus, TaskType, TranslationScope } from "../../../domain/task";

/** progress 只承载可累加的执行进度，任务差异字段必须放进 extras */
export type TaskProgress = {
  line: number;
  total_line: number;
  processed_line: number;
  error_line: number;
  total_tokens: number;
  total_output_tokens: number;
  total_input_tokens: number;
  time: number;
  start_time: number;
  [key: string]: ApiJsonValue;
};

/** translation extras 承载翻译专属语义，重翻条目不再作为顶层快照字段 */
export type TranslationExtras = {
  kind: "translation";
  scope: TranslationScope;
};

/** analysis extras 承载候选术语数等分析专属语义 */
export type AnalysisExtras = {
  kind: "analysis";
  candidate_count: number;
};

/** TaskSnapshot 是 renderer 订阅和 `/api/tasks/snapshot` 的唯一公开形状 */
export type TaskSnapshot = {
  run_revision: number;
  task_type: TaskType;
  status: TaskRunStatus;
  busy: boolean;
  request_in_flight_count: number;
  progress: TaskProgress;
  extras: TranslationExtras | AnalysisExtras;
};
