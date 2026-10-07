import type { JsonValue } from "@earendil-works/chord";
import type { TaskRecord, SubmissionRecord } from "@earendil-works/pi-durable";
import type { AgentEntryStatus } from "../../shared/agent";

/** 日志、时间线和恢复流程共用摘要提交事实，避免任务结束被误报为摘要成功。 */
export function read_agent_compaction_status(
  task: TaskRecord<JsonValue, JsonValue, JsonValue>,
  submissions: ReadonlyMap<number, SubmissionRecord>,
): AgentEntryStatus | "skipped" {
  if (task.state.status !== "terminal") return "running";
  const outcome = task.state.outcome;
  if (outcome.status === "aborted") return "stopped";
  if (outcome.status !== "completed") return "error";
  // SDK 无切点时也返回 `completed`，只有摘要条目或写入回执能证明成功。
  const result = outcome.result;
  if (typeof result !== "object" || result === null || Array.isArray(result)) return "skipped";
  if (typeof result["entryId"] === "number") return "success";
  if (typeof result["submissionId"] !== "number") return "skipped";
  const submission = submissions.get(result["submissionId"]);
  if (submission === undefined || submission.status === "queued" || submission.status === "placed")
    return "running";
  return submission.status === "done" ? "success" : "error";
}
