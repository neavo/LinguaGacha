import type { EffectiveModelRequest } from "./model";
import type { BatchTranslationOperation } from "./batch-translation";

/** 全部密钥不可用且没有普通请求在途时的恢复阶段；阶段由调度器决定，前端时钟只更新秒数。 */
export type BatchTaskRequestRecovery =
  | Readonly<{
      phase: "waiting";
      retry_count: number; // 连续全部不可用期间实际派发的恢复请求数，任一密钥恢复正常后清零。
      retry_at: number; // 毫秒时间戳，同时考虑密钥冷却和请求速率。
    }>
  | Readonly<{ phase: "retrying" }>; // 恢复请求在途。

export type BatchTaskRequestState = Readonly<{
  request_in_flight_count: number;
  request_recovery: BatchTaskRequestRecovery | null;
}>;

export type BatchTaskStatus = "requested" | "running" | "stopping" | "stopped" | "done" | "error";
export type BatchTaskStopSource = "user" | "parent" | "shutdown";
export type BatchTaskKind = "translation" | "request";
export const EMPTY_BATCH_TASK_USAGE = Object.freeze({
  input_tokens: 0,
  reasoning_tokens: 0,
  output_tokens: 0,
});

export type BatchTaskUsage = Readonly<Record<keyof typeof EMPTY_BATCH_TASK_USAGE, number>>;
/** 速度统计只使用模型生成的 Token。 */
export function generated_batch_task_tokens(usage: BatchTaskUsage): number {
  return usage.reasoning_tokens + usage.output_tokens;
}

export type BatchTaskEndpoint = EffectiveModelRequest & Readonly<{ id: string; name: string }>;

/** 配置、模型和思考等级共同区分侧栏接入点。 */
export function batch_task_endpoint_key({
  id,
  model_id,
  thinking_level,
}: BatchTaskEndpoint): string {
  return JSON.stringify([id, model_id, thinking_level]);
}
export type BatchTaskActivity = Readonly<{
  id: string;
  start_time: number;
  usage: BatchTaskUsage;
}>;

export type BatchTaskProgress = BatchTaskUsage &
  Readonly<{
    unit: "item" | "request";
    total: number;
    succeeded: number;
    failed: number;
    start_time: number;
    time: number;
    usage_complete: boolean;
  }>;
export type BatchTaskSnapshot = BatchTaskRequestState &
  Readonly<{
    run_id: string;
    kind: BatchTaskKind;
    source: "standalone" | "agent";
    status: BatchTaskStatus;
    stop_source: BatchTaskStopSource | null;
    endpoint?: BatchTaskEndpoint;
    translation?: Readonly<{
      operation: BatchTranslationOperation;
      pending_item_ids: readonly number[];
    }>;
    progress: BatchTaskProgress | null;
  }>;
export type BatchTaskListSnapshot = Readonly<{
  revision: number;
  project_path: string;
  activity: BatchTaskActivity | null;
  tasks: readonly BatchTaskSnapshot[];
  last_translation: BatchTranslationCompletion | null;
}>;
export type BatchTaskResult = Readonly<{
  run_id: string;
  status: "done" | "stopped" | "error";
  stop_source?: BatchTaskStopSource;
  progress: BatchTaskProgress | null;
}>;
export type BatchTranslationCompletion = Readonly<{
  run_id: string;
  operation: BatchTranslationOperation;
  status: BatchTaskResult["status"];
  failed: number;
}>;

export type BatchTaskSnapshotListener = (
  snapshot: BatchTaskListSnapshot,
  changes: readonly BatchTaskSnapshot[],
) => void | Promise<void>;

/** 批次在受理时记录运行身份与来源，目标和计数由执行者发布。 */
export function create_batch_task_snapshot(
  run_id: string,
  kind: BatchTaskKind,
  source: BatchTaskSnapshot["source"],
): BatchTaskSnapshot {
  return {
    run_id,
    kind,
    source,
    status: "requested",
    stop_source: null,
    progress: null,
    request_in_flight_count: 0,
    request_recovery: null,
  };
}

/** 未知目标使用 null，已知零目标仍有独立进度。 */
export function empty_batch_task_progress(
  unit: BatchTaskProgress["unit"],
  total: number,
): BatchTaskProgress {
  return {
    unit,
    total,
    succeeded: 0,
    failed: 0,
    start_time: Date.now() / 1000,
    time: 0,
    ...EMPTY_BATCH_TASK_USAGE,
    usage_complete: true,
  };
}
