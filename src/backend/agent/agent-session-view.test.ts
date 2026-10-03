import { fauxAssistantMessage, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  EntryId,
  EntryRecord,
  SubmissionId,
  SubmissionRecord,
} from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { AgentSessionDoc } from "./agent-session-state";
import { project_agent_session_entries } from "./agent-session-view";

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
  expect(project_agent_session_entries(records, submissions, [], {}, state)).toMatchObject([
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
