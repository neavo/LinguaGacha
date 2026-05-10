import type { ApiJsonValue } from "../api/api-types";
import type { JsonRecord, MutableJsonRecord, TaskType } from "../task/task-types";

// 任务终态集合用于锁和运行态判断，避免各 runner 自行解释完成语义。
export const TASK_IDLE_STATUSES = new Set(["DONE", "ERROR", "IDLE"]);

/**
 * TS Task Engine 内部运行实例，负责把一次后台任务和取消信号绑定在一起。
 */
export interface TaskRunHandle {
  // run_id 是迟到结果隔离键，所有提交前都必须重新核对。
  run_id: string;
  // task_type 决定公开事件 topic payload 里的任务身份。
  task_type: TaskType;
  // signal 是停止请求向 worker 和 limiter 传播的唯一通道。
  signal: AbortSignal;
}

/**
 * 翻译和分析共享的进度快照字段，字段名保持公开 task snapshot 兼容。
 */
export interface TaskProgressSnapshot {
  start_time: number;
  time: number;
  total_line: number;
  line: number;
  processed_line: number;
  error_line: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

/**
 * TS runner 使用的 item 字典；数据库事实仍是普通 JSON，runner 只读写稳定字段。
 */
export type TaskItemRecord = MutableJsonRecord;

/**
 * Python executor 返回的翻译类 work-unit 结果。
 */
export interface TranslationWorkUnitResult {
  items: TaskItemRecord[];
  row_count: number;
  input_tokens: number;
  output_tokens: number;
  stopped: boolean;
}

/**
 * Python executor 返回的分析 work-unit 结果。
 */
export interface AnalysisWorkUnitResult {
  success: boolean;
  stopped: boolean;
  input_tokens: number;
  output_tokens: number;
  glossary_entries: MutableJsonRecord[];
}

/**
 * Python executor 请求必须携带的公共运行载荷，便于 Python 只处理单个 work unit。
 */
export interface PythonTaskExecutorBaseRequest extends JsonRecord {
  run_id: string;
  work_unit_id: string;
  task_type: TaskType | "translate-single";
  model: ApiJsonValue;
  config_snapshot: ApiJsonValue;
  quality_snapshot: ApiJsonValue;
}

/**
 * TaskPipeline worker 的返回结构，commit 和 retry 明确分离。
 */
export interface TaskPipelineWorkerResult<TContext, TCommit> {
  commit_entries: TCommit[];
  retry_contexts: TContext[];
}
