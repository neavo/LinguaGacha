import { is_model_thinking_level } from "../domain/model";
import type { BatchTaskSnapshot } from "../domain/batch-task";
import { BATCH_TASK_STATUSES } from "../domain/batch-task";
import { is_json_record } from "../domain/json";
/** 无活动批次和未确定目标均有明确的空值。 */
export function empty_batch_task_snapshot(): BatchTaskSnapshot {
  return {
    revision: 0,
    run_id: null,
    project_path: "",
    kind: null,
    source: null,
    status: "idle",
    stop_source: null,
    config: null,
    progress: null,
    request_in_flight_count: 0,
    request_recovery: null,
  };
}
/** 传输只接收完整任务事实，拒绝非数值进度和不一致的结算总量。 */
export function read_batch_task_snapshot(payload: unknown): BatchTaskSnapshot {
  if (!is_json_record(payload) || !is_json_record(payload["batch_task"]))
    return empty_batch_task_snapshot();
  const raw = payload["batch_task"];
  if (
    !BATCH_TASK_STATUSES.includes(raw["status"] as BatchTaskSnapshot["status"]) ||
    typeof raw["revision"] !== "number" ||
    !Number.isSafeInteger(raw["revision"]) ||
    raw["revision"] < 0 ||
    typeof raw["project_path"] !== "string" ||
    (raw["run_id"] !== null && typeof raw["run_id"] !== "string") ||
    ![null, "translation", "request"].includes(raw["kind"] as string | null) ||
    ![null, "standalone", "agent"].includes(raw["source"] as string | null) ||
    ![null, "user", "parent", "shutdown"].includes(raw["stop_source"] as string | null) ||
    typeof raw["request_in_flight_count"] !== "number" ||
    !Number.isSafeInteger(raw["request_in_flight_count"]) ||
    raw["request_in_flight_count"] < 0
  )
    throw new Error("Invalid batch task snapshot.");
  const config = raw["config"];
  if (
    config !== null &&
    (!is_json_record(config) ||
      ["model_config_id", "model_name", "model_id"].some(
        (key) => typeof config[key] !== "string",
      ) ||
      (config["thinking_level"] !== null && !is_model_thinking_level(config["thinking_level"])) ||
      ["concurrency_limit", "rpm_limit"].some(
        (key) =>
          typeof config[key] !== "number" ||
          !Number.isFinite(config[key]) ||
          Number(config[key]) < 0,
      ))
  )
    throw new Error("Invalid batch task config.");
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
      !["item", "request"].includes(String(progress["unit"])) ||
      [
        "total",
        "succeeded",
        "failed",
        "start_time",
        "time",
        "input_tokens",
        "reasoning_tokens",
        "output_tokens",
      ].some(
        (field) =>
          typeof progress[field] !== "number" ||
          !Number.isFinite(progress[field]) ||
          Number(progress[field]) < 0,
      ) ||
      Number(progress["succeeded"]) + Number(progress["failed"]) > Number(progress["total"]))
  )
    throw new Error("Invalid batch task progress.");
  return structuredClone(raw) as unknown as BatchTaskSnapshot;
}

/** 本轮目标决定百分比和预计剩余时间，工程累计统计不参与。 */
export function batch_task_metrics(snapshot: BatchTaskSnapshot | null, now_seconds: number) {
  const progress = snapshot?.progress;
  const active =
    snapshot !== null && ["requested", "running", "stopping"].includes(snapshot.status);
  const elapsed_seconds =
    progress == null ? 0 : active ? Math.max(0, now_seconds - progress.start_time) : progress.time;
  const settled = (progress?.succeeded ?? 0) + (progress?.failed ?? 0);
  return {
    active,
    stopping: snapshot?.status === "stopping",
    status: snapshot?.status ?? "idle",
    total: progress?.total ?? null,
    completion_percent:
      progress == null ? null : progress.total === 0 ? 0 : (settled / progress.total) * 100,
    elapsed_seconds,
    remaining_seconds:
      settled === 0
        ? 0
        : (elapsed_seconds / settled) * Math.max(0, (progress?.total ?? 0) - settled),
    average_generation_speed:
      elapsed_seconds <= 0
        ? 0
        : ((progress?.reasoning_tokens ?? 0) + (progress?.output_tokens ?? 0)) /
          Math.max(1, elapsed_seconds),
    input_tokens: progress?.input_tokens ?? 0,
    reasoning_tokens: progress?.reasoning_tokens ?? 0,
    output_tokens: progress?.output_tokens ?? 0,
    request_in_flight_count: snapshot?.request_in_flight_count ?? 0,
  };
}

/** 展示契约直接跟随唯一计算入口，避免维护第二份可选字段列表。 */
export type BatchTaskMetrics = ReturnType<typeof batch_task_metrics>;
