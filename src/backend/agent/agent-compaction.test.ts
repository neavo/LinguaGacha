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
import { read_agent_compaction_status } from "./agent-compaction";

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
  expect(read_agent_compaction_status(task({}), new Map())).toBe("skipped");
  expect(read_agent_compaction_status(task({ entryId: 3 }), new Map())).toBe("success");
});

it("摘要回执缺失或待写入时继续等待，成功与失败按回执结算", () => {
  const compaction = task({ submissionId: 3 });
  const queued: SubmissionRecord = {
    id: 3 as SubmissionId,
    conversationId,
    type: "write",
    status: "queued",
  };
  expect(read_agent_compaction_status(compaction, new Map())).toBe("running");
  expect(read_agent_compaction_status(compaction, new Map([[3, queued]]))).toBe("running");
  expect(
    read_agent_compaction_status(
      compaction,
      new Map([[3, { ...queued, status: "done", entry: 4 as EntryId }]]),
    ),
  ).toBe("success");
  expect(
    read_agent_compaction_status(
      compaction,
      new Map([[3, { ...queued, status: "unanswered", reason: "stale" }]]),
    ),
  ).toBe("error");
});
