import {
  normalize_batch_translation_progress,
  normalize_batch_translation_run_progress,
  is_active_batch_translation_status,
  BATCH_TRANSLATION_RUN_STATUSES,
  BATCH_TRANSLATION_STOP_SOURCES,
  type BatchTranslationSnapshot,
  type BatchTranslationRunStatus,
} from "../../domain/batch-translation";
import type { BatchTaskRequestRecovery } from "../../domain/batch-task";
export type TranslationTaskActionKind = "reset-all" | "stop-translation";
export type TranslationTaskConfirmState = {
  kind: TranslationTaskActionKind;
  submitting: boolean;
  run_id?: string;
};
export type BatchTranslationPayload = { batch_translation?: Partial<BatchTranslationSnapshot> };
/** 建立工程未加载时的翻译展示起点。 */
export function create_empty_batch_translation_snapshot(): BatchTranslationSnapshot {
  return {
    revision: 0,
    status: "idle",
    source: null,
    request_in_flight_count: 0,
    request_recovery: null,
    progress: normalize_batch_translation_progress({}),
    pending_item_ids: [],
  };
}
/** 归一 HTTP 与 SSE 的翻译快照载荷。 */
export function normalize_batch_translation_snapshot(
  payload: BatchTranslationPayload,
): BatchTranslationSnapshot {
  const raw = payload.batch_translation ?? {};
  const status = BATCH_TRANSLATION_RUN_STATUSES.includes(raw.status as BatchTranslationRunStatus)
    ? (raw.status as BatchTranslationRunStatus)
    : "idle";
  return {
    revision: Math.max(0, Number(raw.revision) || 0),
    ...(typeof raw.run_id === "string" ? { run_id: raw.run_id } : {}),
    ...(raw.operation === "translate" || raw.operation === "retranslate"
      ? { operation: raw.operation }
      : {}),
    ...(raw.run_progress === undefined
      ? {}
      : { run_progress: normalize_batch_translation_run_progress(raw.run_progress) }),
    status,
    source: raw.source === "standalone" || raw.source === "agent" ? raw.source : null,
    ...(raw.stop_source !== undefined && BATCH_TRANSLATION_STOP_SOURCES.includes(raw.stop_source)
      ? { stop_source: raw.stop_source }
      : {}),
    request_in_flight_count: Math.max(0, Number(raw.request_in_flight_count) || 0),
    request_recovery:
      status === "running" ? normalize_request_recovery(raw.request_recovery) : null,
    progress: normalize_batch_translation_progress(raw.progress),
    pending_item_ids: normalize_pending_item_ids(raw.pending_item_ids),
  };
}
/** HTTP 与 SSE 共用校验入口，并冻结恢复事实供历史快照共享。 */
function normalize_request_recovery(raw: unknown): BatchTaskRequestRecovery | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { phase, retry_count, retry_at } = raw as Record<string, unknown>;
  if (phase === "retrying") return Object.freeze({ phase });
  if (
    phase !== "waiting" ||
    typeof retry_count !== "number" ||
    !Number.isSafeInteger(retry_count) ||
    retry_count < 0 ||
    typeof retry_at !== "number" ||
    !Number.isFinite(retry_at)
  )
    return null;
  return Object.freeze({ phase, retry_count, retry_at });
}
/** 独立翻译任务从活跃态自然完成后承接译文生成流程。 */
export function should_open_translation_generation_followup(
  previous_status: BatchTranslationRunStatus,
  snapshot: BatchTranslationSnapshot,
): boolean {
  return (
    is_active_batch_translation_status(previous_status) &&
    snapshot.status === "done" &&
    snapshot.source === "standalone" &&
    snapshot.operation === "translate"
  );
}

/** 传输边界只保留有效目标 ID，并隔离输入数组。 */
function normalize_pending_item_ids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
      ),
    ),
  ];
}
