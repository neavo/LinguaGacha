import { fauxAssistantMessage, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  CommitPublication,
  DocumentId,
  LiveState,
  Seq,
  TaskId,
  EntryId,
  EntryRecord,
  SubmissionId,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { AgentSessionDoc } from "./agent-session-state";
import { AgentSessionView } from "./agent-session-view";

it("已提交历史按用户、助手、工具和后续回答投影，隐藏继续输入不新增条目", () => {
  const state = AgentSessionDoc.definition.initial(null);
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
  const view = new AgentSessionView();
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
  const state = AgentSessionDoc.definition.initial(null);
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
  const view = new AgentSessionView();
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
  const restored = new AgentSessionView();
  restored.reset(view.branch_records(), view.submissions, [], {}, state);
  expect(restored.entries).toEqual(view.entries);
});
