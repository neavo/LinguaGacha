import {
  normalize_batch_translation_progress,
  normalize_batch_translation_config,
  normalize_translation_scope,
  clone_translation_scope,
  is_active_batch_translation_status,
  BATCH_TRANSLATION_RUN_STATUSES,
  BATCH_TRANSLATION_STOP_SOURCES,
  type BatchTranslationSnapshot,
  type BatchTranslationScope,
  type BatchTranslationRunStatus,
} from "../../domain/batch-translation";
export type BatchTranslationMetrics = {
  active: boolean;
  stopping: boolean;
  completion_percent: number;
  processed_count: number;
  failed_count: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  average_generation_speed: number; // 思考与输出 token 的累计平均生成速度
  input_tokens: number;
  reasoning_tokens: number; // 详情展示的累计思考 token
  output_tokens: number; // 详情展示的累计输出 token
  request_in_flight_count: number;
};

/** 将已归一的互斥思考与输出计数恢复为模型完整生成量。 */
export function resolve_batch_translation_generated_tokens(
  metrics: Pick<BatchTranslationMetrics, "reasoning_tokens" | "output_tokens">,
): number {
  return metrics.reasoning_tokens + metrics.output_tokens;
}

/** 后端目标量或累计结果决定是否展示翻译历史。 */
export function has_translation_task_progress(snapshot: BatchTranslationSnapshot | null): boolean {
  if (snapshot === null) {
    return false;
  }
  return (
    snapshot.progress.total_line > 0 ||
    snapshot.progress.line > 0 ||
    snapshot.progress.processed_line > 0 ||
    snapshot.progress.error_line > 0 ||
    snapshot.progress.total_output_tokens > 0 ||
    snapshot.progress.total_reasoning_tokens > 0 ||
    snapshot.progress.total_input_tokens > 0 ||
    snapshot.progress.total_tokens > 0
  );
}

/**
 * 当前运行态或已有结果优先；只有当前无展示价值时才回退到历史终态。
 */
export function resolve_translation_task_display_snapshot(args: {
  current_snapshot: BatchTranslationSnapshot;
  last_snapshot: BatchTranslationSnapshot | null;
}): BatchTranslationSnapshot | null {
  if (
    args.current_snapshot.status !== "idle" ||
    has_translation_task_progress(args.current_snapshot)
  ) {
    return args.current_snapshot;
  }
  return args.last_snapshot !== null &&
    !is_active_batch_translation_status(args.last_snapshot.status) &&
    has_translation_task_progress(args.last_snapshot)
    ? args.last_snapshot
    : null;
}

/**
 * 从翻译快照与显示时钟计算指标，活跃态使用领域状态口径。
 */
export function resolve_translation_task_metrics(args: {
  snapshot: BatchTranslationSnapshot | null;
  now_seconds: number;
}): BatchTranslationMetrics {
  if (args.snapshot === null) {
    return {
      active: false,
      stopping: false,
      completion_percent: 0,
      processed_count: 0,
      failed_count: 0,
      elapsed_seconds: 0,
      remaining_seconds: 0,
      average_generation_speed: 0,
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      request_in_flight_count: 0,
    };
  }

  const snapshot = args.snapshot;
  const active = is_active_batch_translation_status(snapshot.status);
  const elapsed_seconds =
    active && snapshot.progress.start_time > 0
      ? Math.max(0, args.now_seconds - snapshot.progress.start_time)
      : Math.max(0, snapshot.progress.time);
  const output_tokens = Math.max(0, snapshot.progress.total_output_tokens);
  const reasoning_tokens = Math.max(0, snapshot.progress.total_reasoning_tokens);
  const generated_tokens = resolve_batch_translation_generated_tokens({
    reasoning_tokens,
    output_tokens,
  });
  return {
    active,
    stopping: snapshot.status === "stopping",
    completion_percent:
      snapshot.progress.total_line <= 0
        ? 0
        : Math.min(
            1,
            Math.max(0, snapshot.progress.line / Math.max(1, snapshot.progress.total_line)),
          ) * 100,
    processed_count:
      snapshot.progress.processed_line > 0
        ? snapshot.progress.processed_line
        : snapshot.progress.line,
    failed_count: Math.max(0, snapshot.progress.error_line),
    elapsed_seconds,
    remaining_seconds:
      snapshot.progress.line <= 0
        ? 0
        : Math.max(
            0,
            (elapsed_seconds / Math.max(1, snapshot.progress.line)) *
              Math.max(0, snapshot.progress.total_line - snapshot.progress.line),
          ),
    average_generation_speed:
      elapsed_seconds <= 0 ? 0 : generated_tokens / Math.max(1, elapsed_seconds),
    input_tokens:
      snapshot.progress.total_input_tokens > 0
        ? snapshot.progress.total_input_tokens
        : Math.max(
            0,
            snapshot.progress.total_tokens -
              snapshot.progress.total_reasoning_tokens -
              snapshot.progress.total_output_tokens,
          ),
    reasoning_tokens,
    output_tokens,
    request_in_flight_count: Math.max(0, snapshot.request_in_flight_count),
  };
}

export type TranslationTaskActionKind = "reset-all" | "reset-failed" | "stop-translation";
export type TranslationTaskConfirmState = {
  kind: TranslationTaskActionKind;
  submitting: boolean;
};
export type BatchTranslationPayload = { batch_translation?: Partial<BatchTranslationSnapshot> };
/** 建立工程未加载时的翻译展示起点。 */
export function create_empty_batch_translation_snapshot(): BatchTranslationSnapshot {
  return {
    revision: 0,
    status: "idle",
    request_in_flight_count: 0,
    progress: normalize_batch_translation_progress({}),
    scope: { kind: "all" },
  };
}
/** 归一 HTTP 与 SSE 的翻译快照载荷。 */
export function normalize_batch_translation_snapshot(
  payload: BatchTranslationPayload,
): BatchTranslationSnapshot {
  const raw = payload.batch_translation ?? {};
  const config = normalize_batch_translation_config(raw.config);
  const status = BATCH_TRANSLATION_RUN_STATUSES.includes(raw.status as BatchTranslationRunStatus)
    ? (raw.status as BatchTranslationRunStatus)
    : "idle";
  return {
    revision: Math.max(0, Number(raw.revision) || 0),
    ...(config === undefined ? {} : { config }),
    status,
    ...(raw.stop_source !== undefined && BATCH_TRANSLATION_STOP_SOURCES.includes(raw.stop_source)
      ? { stop_source: raw.stop_source }
      : {}),
    request_in_flight_count: Math.max(0, Number(raw.request_in_flight_count) || 0),
    progress: normalize_batch_translation_progress(raw.progress),
    scope: normalize_translation_scope(raw.scope),
  };
}
/** 隔离历史展示中的进度和定点范围引用。 */
export function clone_translation_task_snapshot(
  snapshot: BatchTranslationSnapshot,
): BatchTranslationSnapshot {
  return {
    ...snapshot,
    progress: { ...snapshot.progress },
    ...(snapshot.config === undefined ? {} : { config: { ...snapshot.config } }),
    scope: clone_translation_scope(snapshot.scope),
  };
}

/** 全量任务从活跃态自然完成后承接导出流程。 */
export function should_open_translation_export_followup(args: {
  previous_status: string;
  next_status: string;
  scope: BatchTranslationScope;
}): boolean {
  return (
    args.scope.kind === "all" &&
    is_active_batch_translation_status(args.previous_status) &&
    args.next_status === "done"
  );
}
