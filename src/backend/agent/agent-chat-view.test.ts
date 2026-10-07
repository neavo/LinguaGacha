import type { JsonValue } from "@earendil-works/chord";
import { fauxAssistantMessage, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  CommitPublication,
  DocumentId,
  LiveState,
  Seq,
  TaskId,
  TaskRecord,
  EntryId,
  EntryRecord,
  SubmissionId,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { AgentChatDoc } from "./agent-chat-data";
import { AgentChatView } from "./agent-chat-view";

it("压缩起始时间可随独立文档提交补入，任务终态与恢复沿用同一时间", () => {
  const conversationId = 1 as ConversationId;
  const state = AgentChatDoc.definition.initial(null);
  const task = {
    ...compaction_task({}),
    state: { status: "running", checkpoint: null },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  const view = new AgentChatView();
  view.observe({ seq: 1 as Seq, changes: [{ type: "task", value: task }] });
  view.refresh(conversationId, state);
  expect(view.entries).toEqual([]);
  const timed = { ...state, compactionStartedAt: { 2: 100_000 } };
  view.refresh(conversationId, timed);
  expect(view.entries[0]?.createdAt).toBe(100_000);
  const completed = {
    ...task,
    state: { status: "terminal", outcome: { status: "completed", result: { entryId: 3 } } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  view.observe({ seq: 2 as Seq, changes: [{ type: "task", value: completed }] });
  view.refresh(conversationId, timed);
  expect(view.entries[0]).toMatchObject({ status: "success", createdAt: 100_000 });
  const restored = new AgentChatView();
  restored.reset([], new Map(), [completed], {}, timed);
  expect(restored.entries).toEqual(view.entries);
});

it("已提交历史按用户、助手、工具和后续回答投影，隐藏继续输入不新增条目", () => {
  const state = AgentChatDoc.definition.initial(null);
  state.inputs = {
    input: {
      roundId: "round",
      message: { text: "查询", attachments: [] },
      delivery: "round",
      queuedId: null,
    },
    hidden: {
      roundId: "round",
      message: { text: "继续", attachments: [] },
      delivery: "hidden",
      queuedId: null,
    },
  };
  state.rounds.round = {
    status: "success",
    checkpoint: 0 as EntryId,
    endedAt: 10,
    averageTokensPerSecond: null,
  };
  const conversationId = 1 as ConversationId;
  const messages: Message[] = [
    { role: "user", content: "查询", timestamp: 1 },
    fauxAssistantMessage([
      fauxText("准备查询"),
      fauxToolCall("query", { value: 1 }, { id: "call" }),
    ]),
    {
      role: "toolResult",
      toolCallId: "call",
      toolName: "query",
      content: [{ type: "text", text: "结果" }],
      isError: false,
      timestamp: 3,
    },
    { role: "user", content: "继续", timestamp: 4 },
    fauxAssistantMessage("完成"),
  ];
  const records: EntryRecord[] = messages.map((message, index) => ({
    id: (index + 1) as EntryId,
    conversationId,
    kind: "test",
    model: [message],
  }));
  const submissions = new Map<number, SubmissionRecord>([
    [
      1,
      {
        id: 1 as SubmissionId,
        conversationId,
        requestId: "input",
        type: "input",
        status: "done",
        entry: 1 as EntryId,
        answer: 5 as EntryId,
      },
    ],
    [
      2,
      {
        id: 2 as SubmissionId,
        conversationId,
        requestId: "hidden",
        type: "input",
        status: "done",
        entry: 4 as EntryId,
        answer: 5 as EntryId,
      },
    ],
  ]);
  const view = new AgentChatView();
  view.reset(records, submissions, [], {}, state);
  expect(view.entries).toMatchObject([
    { kind: "user_message", id: "round", text: "查询", status: "success", endedAt: 10 },
    { kind: "assistant_message", parts: [{ kind: "text", text: "准备查询" }], status: "success" },
    {
      kind: "tool_call",
      toolName: "query",
      input: '{"value":1}',
      output: ["结果"],
      status: "success",
    },
    { kind: "assistant_message", parts: [{ kind: "text", text: "完成" }], status: "success" },
  ]);
});

it("流式变化只返回当前条目，终帧与提交变化顺序不影响恢复结果", () => {
  const conversationId = 1 as ConversationId;
  const taskId = 5000 as TaskId;
  const state = AgentChatDoc.definition.initial(null);
  state.inputs.input = {
    roundId: "round",
    message: { text: "问题", attachments: [] },
    delivery: "round",
    queuedId: null,
  };
  state.rounds.round = {
    status: "running",
    checkpoint: 0 as EntryId,
    endedAt: null,
    averageTokensPerSecond: null,
  };
  const view = new AgentChatView();
  view.conversations.set(conversationId, { id: conversationId });
  view.submissions.set(1, {
    id: 1 as SubmissionId,
    conversationId,
    requestId: "input",
    type: "input",
    status: "placed",
    entry: 1 as EntryId,
  });
  view.records.set(1, {
    id: 1 as EntryId,
    conversationId,
    kind: "pi.user",
    model: [{ role: "user", content: "问题", timestamp: 1 }],
  });
  view.records.set(2, {
    id: 2 as EntryId,
    conversationId,
    kind: "pi.assistant",
    model: [fauxAssistantMessage("历史", { timestamp: 2 })],
  });
  view.refresh(conversationId, state);
  view.take_change();
  const oldEntry = view.entries[1];
  const partial = fauxAssistantMessage("开头", { timestamp: 2000 });
  const live: LiveState = {
    run: { taskId, inputs: [1 as SubmissionId] },
    generation: {
      attempt: 0,
      message: partial as NonNullable<NonNullable<LiveState["generation"]>["message"]>,
    },
  };
  const liveChange: Extract<CommitPublication["changes"][number], { type: "document" }> = {
    type: "document",
    record: {
      id: 1 as DocumentId,
      kind: "pi.live",
      scope: { kind: "conversation", conversationId },
      history: "latest",
      fork: "initial",
      createdAt: 1 as Seq,
    },
    conversationId,
    version: 1,
    value: live,
    ops: [],
  };
  view.observe({ seq: 1 as Seq, changes: [liveChange] });
  view.refresh(conversationId, state);
  expect(view.take_change()).toMatchObject({
    replace: false,
    entries: [{ id: "assistant:5000", status: "running" }],
  });
  const failed: EntryRecord = {
    id: 5001 as EntryId,
    conversationId,
    byTaskId: taskId,
    kind: "pi.assistant",
    model: [fauxAssistantMessage("中间失败", { timestamp: 2000, stopReason: "error" })],
  };
  view.observe({
    seq: 2 as Seq,
    changes: [
      { ...liveChange, value: {} },
      { type: "entry", value: failed },
    ],
  });
  view.refresh(conversationId, state);
  view.take_change();
  const retry: LiveState = {
    ...live,
    generation: {
      attempt: 1,
      message: { ...live.generation!.message!, content: [{ type: "text", text: "重试正文" }] },
    },
  };
  view.observe({ seq: 3 as Seq, changes: [{ ...liveChange, value: retry }] });
  view.refresh(conversationId, state);
  expect(view.take_change().entries).toMatchObject([
    { id: "assistant:5000", status: "running", parts: [{ text: "重试正文" }] },
  ]);
  const completed: EntryRecord = {
    id: 5002 as EntryId,
    conversationId,
    byTaskId: taskId,
    kind: "pi.assistant",
    model: [fauxAssistantMessage("完整回答", { timestamp: 2000 })],
  };
  const changes: CommitPublication["changes"] = [
    { ...liveChange, value: {} },
    { type: "entry", value: completed },
  ];
  // `LiveDoc` 在正式条目前出现，消费者仍以整批提交后的事实为准。
  view.observe({ seq: 4 as Seq, changes });
  view.refresh(conversationId, state);
  expect(view.take_change()).toMatchObject({
    replace: false,
    entries: [{ id: "assistant:5000", status: "success", parts: [{ text: "完整回答" }] }],
  });
  expect(view.entries[1]).toBe(oldEntry);
  const restored = new AgentChatView();
  restored.reset(view.branch_records(), view.submissions, [], {}, state);
  expect(restored.entries).toEqual(view.entries);
});

/** 压缩投影使用原生任务身份，状态来自各测试指定的 SDK 事实。 */
function compaction_task(result: JsonValue) {
  return {
    id: 2 as TaskId<JsonValue>,
    conversationId: 1 as ConversationId,
    kind: "pi.compaction",
    version: 1,
    input: { reason: "manual" },
    background: false,
    abortRequested: false,
    state: { status: "terminal", outcome: { status: "completed", result } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
}

it("摘要回执更新已结束任务的时间线，恢复得到相同结果", () => {
  const task = compaction_task({ submissionId: 3 });
  const queued: SubmissionRecord = {
    id: 3 as SubmissionId,
    conversationId: task.conversationId,
    type: "write",
    status: "queued",
  };
  const state = { ...AgentChatDoc.definition.initial(null), compactionStartedAt: { 2: 1000 } };
  const view = new AgentChatView();
  view.observe({
    seq: 1 as Seq,
    changes: [
      { type: "task", value: task },
      { type: "submission", value: queued },
    ],
  });
  view.refresh(task.conversationId, state);
  expect(view.entries[0]?.status).toBe("running");
  const done: SubmissionRecord = { ...queued, status: "done", entry: 4 as EntryId };
  view.observe({ seq: 2 as Seq, changes: [{ type: "submission", value: done }] });
  view.refresh(task.conversationId, state);
  expect(view.entries[0]?.status).toBe("success");
  const restored = new AgentChatView();
  restored.submissions.set(done.id, done);
  restored.reset([], new Map(), [task], {}, state);
  expect(restored.entries).toEqual(view.entries);
});

it("空结果始终隐藏压缩块，恢复也不公开空操作", () => {
  const task = compaction_task({});
  const state = { ...AgentChatDoc.definition.initial(null), compactionStartedAt: { 2: 1000 } };
  const view = new AgentChatView();
  view.observe({ seq: 1 as Seq, changes: [{ type: "task", value: task }] });
  view.refresh(task.conversationId, state);
  expect(view.entries).toEqual([]);
  expect(view.take_change().entries).toEqual([]);
  const restored = new AgentChatView();
  restored.reset([], new Map(), [task], {}, state);
  expect(restored.entries).toEqual([]);
});

it("摘要阶段取消保留起点，选择阶段取消隐藏，失败保留诊断条目", () => {
  const task = {
    ...compaction_task({}),
    state: { status: "terminal", outcome: { status: "aborted" } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  const state = AgentChatDoc.definition.initial(null);
  const view = new AgentChatView();
  view.reset([], new Map(), [task], {}, state);
  expect(view.entries).toEqual([]);
  view.reset([], new Map(), [task], {}, { ...state, compactionStartedAt: { 2: 1000 } });
  expect(view.entries[0]).toMatchObject({ status: "stopped", createdAt: 1000 });
  const failed = {
    ...task,
    state: {
      status: "terminal",
      outcome: { status: "failed", error: { message: "model unavailable" } },
    },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  view.reset([], new Map(), [failed], {}, state);
  expect(view.entries[0]).toMatchObject({ status: "error", createdAt: null });
});
