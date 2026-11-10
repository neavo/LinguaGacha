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
  request_concurrency_limit?: number;
  request_recovery: BatchTaskRequestRecovery | null;
}>;

export const BATCH_TASK_STATUSES = [
  "idle",
  "requested",
  "running",
  "stopping",
  "stopped",
  "done",
  "error",
] as const;
export type BatchTaskStatus = (typeof BATCH_TASK_STATUSES)[number];
export type BatchTaskStopSource = "user" | "parent" | "shutdown";
export type BatchTaskKind = "translation" | "request";
export type BatchTaskConfig = Readonly<{
  model_config_id: string;
  model_name: string;
  model_id: string;
  thinking_level: import("./model").ModelThinkingLevel | null;
  concurrency_limit: number;
  rpm_limit: number;
}>;
export type BatchTaskProgress = Readonly<{
  unit: "item" | "request";
  total: number;
  succeeded: number;
  failed: number;
  start_time: number;
  time: number;
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  usage_complete: boolean;
}>;
export type BatchTaskSnapshot = BatchTaskRequestState &
  Readonly<{
    revision: number;
    run_id: string | null;
    project_path: string;
    kind: BatchTaskKind | null;
    source: "standalone" | "agent" | null;
    status: BatchTaskStatus;
    stop_source: BatchTaskStopSource | null;
    config: BatchTaskConfig | null;
    progress: BatchTaskProgress | null;
  }>;
export type BatchTaskResult = Readonly<{
  run_id: string;
  status: "done" | "stopped" | "error";
  stop_source?: BatchTaskStopSource;
  progress: BatchTaskProgress | null;
}>;
export type BatchTaskSnapshotListener = (snapshot: BatchTaskSnapshot) => void | Promise<void>;

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
    input_tokens: 0,
    reasoning_tokens: 0,
    output_tokens: 0,
    usage_complete: true,
  };
}
