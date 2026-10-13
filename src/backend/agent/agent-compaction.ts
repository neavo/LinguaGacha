import type { JsonValue } from "@earendil-works/chord";
import type { TaskRecord, SubmissionRecord } from "@earendil-works/pi-durable";

export type AgentCompactionResult =
  | { status: "running" | "success" | "skipped" | "stopped" }
  | { status: "error"; error: AgentCompactionError };

/** 日志、时间线和恢复流程共用摘要提交事实，避免任务结束被误报为摘要成功。 */
export function read_agent_compaction_result(
  task: TaskRecord<JsonValue, JsonValue, JsonValue>,
  submissions: ReadonlyMap<number, SubmissionRecord>,
): AgentCompactionResult {
  if (task.state.status !== "terminal") return { status: "running" };
  const outcome = task.state.outcome;
  if (outcome.status === "aborted") return { status: "stopped" };
  if (outcome.status === "failed" || outcome.status === "faulted")
    return {
      status: "error",
      error: new AgentCompactionError(task.id, outcome.error.message, outcome.error.detail),
    };
  if (outcome.status === "orphaned")
    return { status: "error", error: new AgentCompactionError(task.id, outcome.reason) };
  // SDK 无切点时也返回 `completed`，只有摘要条目或写入回执能证明成功。
  const result = outcome.result;
  if (typeof result !== "object" || result === null || Array.isArray(result))
    return { status: "skipped" };
  if (typeof result["entryId"] === "number") return { status: "success" };
  if (typeof result["submissionId"] !== "number") return { status: "skipped" };
  const submission = submissions.get(result["submissionId"]);
  if (submission === undefined || submission.status === "queued" || submission.status === "placed")
    return { status: "running" };
  if (submission.status === "done") return { status: "success" };
  return {
    status: "error",
    error: new AgentCompactionError(task.id, "Compaction summary was not placed", submission),
  };
}

/** 原生压缩终态已保存诊断，回合只记录导致终止的任务身份。 */
export class AgentCompactionError extends Error {
  /** 关联已保存诊断的原生任务，回合终止只引用该任务身份。 */
  public constructor(
    public readonly task_id: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AgentCompactionError";
  }
}
