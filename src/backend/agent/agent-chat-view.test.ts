import type { JsonValue } from "@earendil-works/chord/json";
import { fauxAssistantMessage, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type {
  ConversationId,
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

it("压缩起始时间可随独立文档提交补入，任务结算沿用该时间", () => {
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
});

it("已提交历史按用户、助手、工具和后续回答投影，隐藏继续输入不新增条目", () => {
  const state = AgentChatDoc.definition.initial(null);
  state.inputs = {
    input: {
      roundId: "round",
      message: { text: "查询", attachments: [] },
      delivery: "round",
    },
    hidden: {
      roundId: "round",
      message: { text: "继续", attachments: [] },
      delivery: "hidden",
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
    fauxAssistantMessage(
      [
        fauxText("准备查询"),
        fauxToolCall("query", { value: 1 }, { id: "call" }),
        fauxToolCall("query", { value: 2 }, { id: "legacy-call" }),
      ],
      { stopReason: "toolUse", timestamp: 2 },
    ),
    {
      role: "toolResult",
      toolCallId: "legacy-call",
      toolName: "query",
      content: [{ type: "text", text: "旧回执" }],
      isError: false,
      timestamp: 4,
    },
    {
      role: "toolResult",
      toolCallId: "call",
      toolName: "query",
      content: [{ type: "text", text: "结果" }],
      isError: false,
      timestamp: 9,
      durationMs: 2,
    },
    { role: "user", content: "继续", timestamp: 10 },
    fauxAssistantMessage("完成"),
  ];
  const records: EntryRecord[] = messages.map((message, index) => ({
    id: (index + 1) as EntryId,
    conversationId,
    kind: "test",
    model: [message],
  }));
  const view = new AgentChatView();
  for (const record of records.slice(0, 2)) view.records.set(record.id, record);
  for (const [id, requestId, entry] of [
    [1, "input", 1],
    [2, "hidden", 5],
  ] as const) {
    view.submissions.set(id, {
      id: id as SubmissionId,
      conversationId,
      requestId,
      type: "input",
      status: "done",
      entry: entry as EntryId,
      answer: 6 as EntryId,
    });
  }
  view.refresh(conversationId, state);
  expect(view.entries.map((entry) => entry.kind)).toEqual(["user_message", "assistant_message"]);
  view.take_change();
  view.observe({ seq: 1 as Seq, changes: [{ type: "entry", value: records[2]! }] });
  view.refresh(conversationId, state);
  expect(view.take_change().replace).toBe(false);
  view.observe({
    seq: 2 as Seq,
    changes: records.slice(3).map((value) => ({ type: "entry", value })),
  });
  view.refresh(conversationId, state);
  expect(view.entries).toMatchObject([
    { kind: "user_message", id: "round", text: "查询", status: "success", endedAt: 10 },
    { kind: "assistant_message", parts: [{ kind: "text", text: "准备查询" }], status: "success" },
    {
      kind: "tool_call",
      toolName: "query",
      input: '{"value":1}',
      output: ["结果"],
      status: "success",
      createdAt: 7,
      endedAt: 9,
    },
    {
      kind: "tool_call",
      input: '{"value":2}',
      output: ["旧回执"],
      status: "success",
      createdAt: 4,
      endedAt: null,
    },
    { kind: "assistant_message", parts: [{ kind: "text", text: "完成" }], status: "success" },
  ]);
  expect(view.take_change().replace).toBe(true); // 较早声明的调用后结算，前端需要重新排序。
  const restored = new AgentChatView();
  for (const record of view.branch_records()) restored.records.set(record.id, record);
  for (const submission of view.submissions.values())
    restored.submissions.set(submission.id, submission);
  restored.refresh(conversationId, state);
  expect(restored.entries).toEqual(view.entries);
});

it("流式变化只返回当前条目，终帧与提交变化顺序不影响恢复结果", () => {
  const conversationId = 1 as ConversationId;
  const taskId = 5000 as TaskId;
  const state = AgentChatDoc.definition.initial(null);
  state.inputs.input = {
    roundId: "round",
    message: { text: "问题", attachments: [] },
    delivery: "round",
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
    run: { taskId, turns: 0, inputs: [1 as SubmissionId] },
    generation: {
      attempt: 0,
      message: partial as NonNullable<NonNullable<LiveState["generation"]>["message"]>,
    },
  };
  view.update_live(live);
  view.refresh(conversationId, state);
  expect(view.take_change()).toMatchObject({
    replace: false,
    entries: [{ id: "assistant:5000", status: "running" }],
  });
  view.update_live(live);
  view.refresh(conversationId, state);
  expect(view.take_change().entries).toEqual([]);
  const failed: EntryRecord = {
    id: 5001 as EntryId,
    conversationId,
    byTaskId: taskId,
    kind: "pi.assistant",
    model: [fauxAssistantMessage("中间失败", { timestamp: 2000, stopReason: "error" })],
  };
  view.update_live({});
  view.observe({
    seq: 2 as Seq,
    changes: [{ type: "entry", value: failed }],
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
  view.update_live(retry);
  view.refresh(conversationId, state);
  expect(view.take_change().entries).toMatchObject([
    { id: "assistant:5000", status: "running", parts: [{ text: "重试正文" }] },
  ]);
  view.update_live(live);
  view.refresh(conversationId, state, true);
  expect(view.take_change().entries).toEqual([]);
  const completed: EntryRecord = {
    id: 5002 as EntryId,
    conversationId,
    byTaskId: taskId,
    kind: "pi.assistant",
    model: [fauxAssistantMessage("完整回答", { timestamp: 2000 })],
  };
  view.update_live({});
  view.observe({ seq: 4 as Seq, changes: [{ type: "entry", value: completed }] });
  view.refresh(conversationId, state, true);
  expect(view.take_change()).toMatchObject({
    replace: false,
    entries: [{ id: "assistant:5000", status: "success", parts: [{ text: "完整回答" }] }],
  });
  expect(view.entries[1]).toBe(oldEntry);
  const restored = new AgentChatView();
  for (const record of view.branch_records()) restored.records.set(record.id, record);
  for (const [id, submission] of view.submissions) restored.submissions.set(id, submission);
  restored.refresh(conversationId, state);
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
  view.refresh(task.conversationId, state);
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
  restored.compactions.set(task.id, task);
  restored.submissions.set(queued.id, queued);
  restored.refresh(task.conversationId, state);
  expect(restored.entries[0]?.status).toBe("running");
  restored.observe({ seq: 2 as Seq, changes: [{ type: "submission", value: done }] });
  restored.refresh(task.conversationId, state);
  expect(restored.entries).toEqual(view.entries);
});

it("重开时不公开无切点的压缩", () => {
  const task = compaction_task({});
  const state = { ...AgentChatDoc.definition.initial(null), compactionStartedAt: { 2: 1000 } };
  const view = new AgentChatView();
  view.compactions.set(task.id, task);
  view.refresh(task.conversationId, state);
  expect(view.entries).toEqual([]);
});

it("摘要阶段取消保留起点，选择阶段取消隐藏，失败保留诊断条目", () => {
  const task = {
    ...compaction_task({}),
    state: { status: "terminal", outcome: { status: "aborted" } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  const state = AgentChatDoc.definition.initial(null);
  const view = new AgentChatView();
  view.compactions.set(task.id, task);
  view.refresh(task.conversationId, state);
  expect(view.entries).toEqual([]);
  view.refresh(task.conversationId, { ...state, compactionStartedAt: { 2: 1000 } });
  expect(view.entries[0]).toMatchObject({ status: "stopped", createdAt: 1000 });
  const failed = {
    ...task,
    state: {
      status: "terminal",
      outcome: { status: "failed", error: { message: "model unavailable" } },
    },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  const failed_view = new AgentChatView();
  failed_view.compactions.set(failed.id, failed);
  failed_view.refresh(failed.conversationId, state);
  expect(failed_view.entries[0]).toMatchObject({ status: "error", createdAt: null });
});

it("切换分支时只显示可见的工具及回执图片", () => {
  const mainConversation = 1 as ConversationId;
  const branchConversation = 2 as ConversationId;
  const state = AgentChatDoc.definition.initial(null);
  state.inputs = {
    input: {
      roundId: "round",
      message: { text: "绘图", attachments: [] },
      delivery: "round",
    },
  };
  state.rounds.round = {
    status: "success",
    checkpoint: 0 as EntryId,
    endedAt: 30,
    averageTokensPerSecond: null,
  };
  const view = new AgentChatView();
  view.observe({
    seq: 1 as Seq,
    changes: [
      { type: "conversation", value: { id: mainConversation } },
      {
        type: "conversation",
        value: {
          id: branchConversation,
          parent: { conversationId: mainConversation, at: 1 as EntryId },
        },
      },
      {
        type: "submission",
        value: {
          id: 1 as SubmissionId,
          conversationId: mainConversation,
          requestId: "input",
          type: "input",
          status: "done",
          entry: 1 as EntryId,
          answer: 3 as EntryId,
        },
      },
    ],
  });
  const userRecord: EntryRecord = {
    id: 1 as EntryId,
    conversationId: mainConversation,
    kind: "pi.user",
    model: [{ role: "user", content: "绘图", timestamp: 5 }],
  };
  const callRecord: EntryRecord = {
    id: 2 as EntryId,
    conversationId: mainConversation,
    kind: "pi.assistant",
    model: [
      fauxAssistantMessage(
        [fauxToolCall("workspace_run", { script: "draw()" }, { id: "call-1" })],
        {
          stopReason: "toolUse",
          timestamp: 10,
        },
      ),
    ],
  };
  const pngA = Buffer.from("png-a").toString("base64");
  const webpB = Buffer.from("webp-b").toString("base64");
  const resultWithImages: EntryRecord = {
    id: 3 as EntryId,
    conversationId: mainConversation,
    kind: "pi.toolResult",
    model: [
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "workspace_run",
        content: [
          { type: "text", text: "第一段" },
          { type: "image", data: pngA, mimeType: "image/png" },
          {
            type: "image",
            data: Buffer.from("<svg/>").toString("base64"),
            mimeType: "image/svg+xml",
          },
          { type: "image", data: "", mimeType: "image/webp" },
          { type: "image", data: webpB, mimeType: "image/webp" },
          { type: "text", text: "第二段" },
        ],
        isError: false,
        timestamp: 20,
        durationMs: 6,
      },
    ],
  };
  const pendingTask = {
    id: 4 as TaskId<JsonValue>,
    conversationId: mainConversation,
    kind: "pi.tool",
    version: 4,
    input: { kind: "model", assistant: callRecord.id, callId: "call-1" },
    background: false,
    abortRequested: false,
    state: { status: "pending", checkpoint: { phase: "call" } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  view.observe({
    seq: 2 as Seq,
    changes: [
      { type: "entry", value: userRecord },
      { type: "entry", value: callRecord },
      { type: "task", value: pendingTask },
    ],
  });
  view.refresh(mainConversation, state);
  expect(view.entries).toHaveLength(1);
  view.refresh(branchConversation, state);
  const runningTask = {
    ...pendingTask,
    startedAt: 14,
    state: { status: "running", checkpoint: { phase: "call" } },
  } satisfies TaskRecord<JsonValue, JsonValue, JsonValue>;
  view.observe({ seq: 3 as Seq, changes: [{ type: "task", value: runningTask }] });
  view.refresh(branchConversation, state);
  expect(view.entries).toHaveLength(1);
  view.refresh(mainConversation, state);
  expect(view.entries[1]).toMatchObject({
    status: "running",
    createdAt: 14,
    endedAt: null,
  });
  view.observe({
    seq: 4 as Seq,
    changes: [
      { type: "entry", value: resultWithImages },
      {
        type: "task",
        value: {
          ...runningTask,
          state: { status: "terminal", outcome: { status: "completed", result: null } },
        },
      },
    ],
  });
  view.refresh(mainConversation, state);

  expect(view.entries[1]).toMatchObject({
    imageCount: 2,
    status: "success",
    output: ["第一段", "第二段"],
  });
  expect(view.read_tool_image("tool:2:call-1", 0)).toEqual({
    type: "image",
    data: pngA,
    mimeType: "image/png",
  });
  expect(view.read_tool_image("tool:2:call-1", 1)).toEqual({
    type: "image",
    data: webpB,
    mimeType: "image/webp",
  });
  expect(view.read_tool_image("tool:2:call-1", 2)).toBeUndefined();

  view.refresh(branchConversation, state);
  expect(view.entries).toHaveLength(1);
  expect(view.read_tool_image("tool:2:call-1", 0)).toBeUndefined();

  view.refresh(mainConversation, state);
  expect(view.read_tool_image("tool:2:call-1", 0)).toEqual({
    type: "image",
    data: pngA,
    mimeType: "image/png",
  });
});
