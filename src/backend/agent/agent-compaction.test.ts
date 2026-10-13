import type { JsonValue } from "@earendil-works/chord";
import type {
  ConversationId,
  EntryId,
  SubmissionId,
  SubmissionRecord,
  TaskId,
  TaskRecord,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { read_agent_compaction_result } from "./agent-compaction";

const conversationId = 1 as ConversationId;
/** 构造 SDK 压缩结果，规则测试只观察结算状态。 */
function task(result: JsonValue) {
  return {
    id: 2 as TaskId<JsonValue>,
    conversationId,
    kind: "pi.compaction",
    version: 1,
    input: { reason: "manual" },
    background: false,
    abortRequested: false,
    state: { status: "terminal", outcome: { status: "completed", result } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
}

it("空结果内部判定为 skipped，摘要直接写入才判定为 success", () => {
  expect(read_agent_compaction_result(task({}), new Map())).toEqual({ status: "skipped" });
  expect(read_agent_compaction_result(task({ entryId: 3 }), new Map())).toEqual({
    status: "success",
  });
});

it("摘要回执缺失或待写入时继续等待，成功与失败按回执结算", () => {
  const compaction = task({ submissionId: 3 });
  const queued: SubmissionRecord = {
    id: 3 as SubmissionId,
    conversationId,
    type: "write",
    status: "queued",
  };
  expect(read_agent_compaction_result(compaction, new Map())).toEqual({ status: "running" });
  expect(read_agent_compaction_result(compaction, new Map([[3, queued]]))).toEqual({
    status: "running",
  });
  expect(
    read_agent_compaction_result(
      compaction,
      new Map([[3, { ...queued, status: "done", entry: 4 as EntryId }]]),
    ),
  ).toEqual({ status: "success" });
  expect(
    read_agent_compaction_result(
      compaction,
      new Map([[3, { ...queued, status: "unanswered", reason: "stale" }]]),
    ),
  ).toMatchObject({
    status: "error",
    error: {
      task_id: 2,
      message: "Compaction summary was not placed",
      cause: { status: "unanswered", reason: "stale" },
    },
  });
});

it.each(["failed", "faulted"] as const)("压缩 %s 保留 SDK 原始消息与错误上下文", (status) => {
  const detail = { reason: "fixture", operation: "summary" };
  const record = {
    ...task({}),
    state: { status: "terminal", outcome: { status, error: { message: "原始压缩故障", detail } } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  const result = read_agent_compaction_result(record, new Map());
  expect(result).toMatchObject({
    status: "error",
    error: { task_id: record.id, message: "原始压缩故障", cause: detail },
  });
});

it("孤立与取消按各自原始终态解释", () => {
  const orphaned = {
    ...task({}),
    state: { status: "terminal", outcome: { status: "orphaned", reason: "任务定义缺失" } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  expect(read_agent_compaction_result(orphaned, new Map())).toMatchObject({
    status: "error",
    error: { task_id: orphaned.id, message: "任务定义缺失" },
  });
  const aborted = {
    ...task({}),
    state: { status: "terminal", outcome: { status: "aborted" } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  expect(read_agent_compaction_result(aborted, new Map())).toEqual({ status: "stopped" });
});
