import {
  batch_task_endpoint_key,
  EMPTY_BATCH_TASK_USAGE,
  generated_batch_task_tokens,
  type BatchTaskActivity,
  type BatchTaskEndpoint,
  type BatchTaskKind,
  type BatchTaskListSnapshot,
  type BatchTaskSnapshot,
  type BatchTranslationCompletion,
} from "../domain/batch-task";
import { is_json_record } from "../domain/json";
import { is_model_thinking_level } from "../domain/model";

/** 工程镜像收到首次快照前使用的状态。 */
export function empty_batch_task_list_snapshot(): BatchTaskListSnapshot {
  return {
    revision: 0,
    project_path: "",
    activity: null,
    tasks: [],
    last_translation: null,
  };
}

/** HTTP 和 SSE 共用的快照读取入口。 */
export function read_batch_task_list_snapshot(payload: unknown): BatchTaskListSnapshot {
  const raw = is_json_record(payload) ? payload["batch_tasks"] : undefined;
  if (
    !is_json_record(raw) ||
    typeof raw["revision"] !== "number" ||
    !Number.isSafeInteger(raw["revision"]) ||
    raw["revision"] < 0 ||
    typeof raw["project_path"] !== "string" ||
    !Array.isArray(raw["tasks"])
  )
    throw new Error("Invalid batch task list snapshot.");
  return {
    revision: raw["revision"],
    project_path: raw["project_path"],
    activity: read_activity(raw["activity"]),
    tasks: raw["tasks"].map(read_batch_task),
    last_translation: read_translation_completion(raw["last_translation"]),
  };
}

/** 读取跨批次累计的活跃轮次。 */
function read_activity(value: unknown): BatchTaskActivity | null {
  if (value === null) return null;
  if (
    !is_json_record(value) ||
    typeof value["id"] !== "string" ||
    !is_non_negative_number(value["start_time"])
  )
    throw new Error("Invalid batch task activity.");
  const usage = value["usage"];
  if (
    !is_json_record(usage) ||
    !is_non_negative_number(usage["input_tokens"]) ||
    !is_non_negative_number(usage["reasoning_tokens"]) ||
    !is_non_negative_number(usage["output_tokens"])
  )
    throw new Error("Invalid batch task usage.");
  return {
    id: value["id"],
    start_time: value["start_time"],
    usage: {
      input_tokens: usage["input_tokens"],
      reasoning_tokens: usage["reasoning_tokens"],
      output_tokens: usage["output_tokens"],
    },
  };
}

/** 进度和用量允许小数，时间以秒计。 */
function is_non_negative_number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 活跃列表接收任务和可选明细，终态单独交接。 */
function read_batch_task(raw: unknown): BatchTaskSnapshot {
  if (
    !is_json_record(raw) ||
    (raw["status"] !== "requested" &&
      raw["status"] !== "running" &&
      raw["status"] !== "stopping") ||
    typeof raw["run_id"] !== "string" ||
    raw["run_id"] === "" ||
    (raw["kind"] !== "translation" && raw["kind"] !== "request") ||
    (raw["source"] !== "standalone" && raw["source"] !== "agent") ||
    (raw["stop_source"] !== null &&
      raw["stop_source"] !== "user" &&
      raw["stop_source"] !== "parent" &&
      raw["stop_source"] !== "shutdown") ||
    typeof raw["request_in_flight_count"] !== "number" ||
    !Number.isSafeInteger(raw["request_in_flight_count"]) ||
    raw["request_in_flight_count"] < 0
  )
    throw new Error("Invalid batch task snapshot.");
  const endpoint = raw["endpoint"];
  if (
    endpoint !== undefined &&
    (!is_json_record(endpoint) ||
      typeof endpoint["id"] !== "string" ||
      typeof endpoint["name"] !== "string" ||
      typeof endpoint["model_id"] !== "string" ||
      (endpoint["thinking_level"] !== "CUSTOM" &&
        !is_model_thinking_level(endpoint["thinking_level"])))
  )
    throw new Error("Invalid batch task endpoint.");
  const translation = raw["translation"];
  if (
    (raw["kind"] === "request" && translation !== undefined) ||
    (raw["kind"] === "translation" &&
      (!is_json_record(translation) ||
        (translation["operation"] !== "translate" && translation["operation"] !== "retranslate") ||
        !Array.isArray(translation["pending_item_ids"]) ||
        !translation["pending_item_ids"].every(
          (id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
        )))
  )
    throw new Error("Invalid translation task targets.");
  const recovery = raw["request_recovery"];
  if (
    recovery !== null &&
    (!is_json_record(recovery) ||
      (recovery["phase"] !== "retrying" &&
        !(
          recovery["phase"] === "waiting" &&
          typeof recovery["retry_count"] === "number" &&
          Number.isSafeInteger(recovery["retry_count"]) &&
          recovery["retry_count"] >= 0 &&
          typeof recovery["retry_at"] === "number" &&
          Number.isFinite(recovery["retry_at"])
        )))
  )
    throw new Error("Invalid batch task recovery.");
  const progress = raw["progress"];
  if (
    progress !== null &&
    (!is_json_record(progress) ||
      (progress["unit"] !== "item" && progress["unit"] !== "request") ||
      typeof progress["usage_complete"] !== "boolean" ||
      [
        "total",
        "succeeded",
        "failed",
        "start_time",
        "time",
        "input_tokens",
        "reasoning_tokens",
        "output_tokens",
      ].some((field) => !is_non_negative_number(progress[field])))
  )
    throw new Error("Invalid batch task progress.");
  return raw as unknown as BatchTaskSnapshot;
}

/** 读取供工程会话消费的一条独立翻译回执。 */
function read_translation_completion(value: unknown): BatchTranslationCompletion | null {
  if (value === null) return null;
  if (
    !is_json_record(value) ||
    typeof value["run_id"] !== "string" ||
    (value["operation"] !== "translate" && value["operation"] !== "retranslate") ||
    (value["status"] !== "done" && value["status"] !== "stopped" && value["status"] !== "error") ||
    typeof value["failed"] !== "number" ||
    !Number.isSafeInteger(value["failed"]) ||
    value["failed"] < 0
  )
    throw new Error("Invalid translation completion.");
  return {
    run_id: value["run_id"],
    operation: value["operation"],
    status: value["status"],
    failed: value["failed"],
  };
}

/** 进度仅合计活跃且单位相同的批次。工程文件的累计完成率由条目查询提供。 */
export function batch_task_metrics(
  { tasks, activity }: BatchTaskListSnapshot,
  now_seconds: number,
) {
  const first = tasks[0];
  const kind: BatchTaskKind | "mixed" | null =
    first === undefined
      ? null
      : tasks.every((task) => task.kind === first.kind)
        ? first.kind
        : "mixed";
  let total = 0;
  let settled = 0;
  let known = kind !== null && kind !== "mixed";
  let request_in_flight_count = 0;
  let remaining_seconds = 0;
  const endpoints = new Map<string, BatchTaskEndpoint>();
  for (const { endpoint, progress, request_in_flight_count: in_flight } of tasks) {
    if (endpoint !== undefined) endpoints.set(batch_task_endpoint_key(endpoint), endpoint);
    request_in_flight_count += in_flight;
    if (progress === null) {
      known = false;
    } else {
      total += progress.total;
      const finished = progress.succeeded + progress.failed;
      settled += finished;
      if (finished > 0) {
        const elapsed = Math.max(0, now_seconds - progress.start_time);
        const remaining = (elapsed * (progress.total - finished)) / finished;
        remaining_seconds = Math.max(remaining_seconds, remaining);
      }
    }
  }
  const active_endpoints: readonly BatchTaskEndpoint[] = [...endpoints.values()];
  const usage = activity?.usage ?? EMPTY_BATCH_TASK_USAGE;
  const elapsed_seconds = activity === null ? 0 : Math.max(0, now_seconds - activity.start_time);
  return {
    kind,
    endpoints: active_endpoints,
    elapsed_seconds,
    remaining_seconds,
    usage,
    average_speed: elapsed_seconds > 0 ? generated_batch_task_tokens(usage) / elapsed_seconds : 0,
    stopping: first !== undefined && tasks.every((task) => task.status === "stopping"),
    completion_percent: known && total > 0 ? (100 * settled) / total : null,
    request_in_flight_count,
  };
}

export type BatchTaskMetrics = ReturnType<typeof batch_task_metrics>;
