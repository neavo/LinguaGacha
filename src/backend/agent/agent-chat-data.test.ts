import { expect, it } from "vitest";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineDocFamily,
  type EntryRecord,
  type EntryId,
  type ConversationId,
  type SubmissionId,
  type SubmissionRecord,
} from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  AGENT_INPUT_ENTRY_KIND,
  AgentChatDoc,
  read_agent_input,
  type AgentInputRecord,
  type AgentChatData,
} from "./agent-chat-data";

const input: AgentInputRecord = {
  roundId: "round",
  message: { text: " 原始输入 ", attachments: [] },
  delivery: "round",
  queuedId: null,
};
const entry = {
  id: 2 as EntryId,
  conversationId: 1 as ConversationId,
  kind: AGENT_INPUT_ENTRY_KIND,
  data: input,
} satisfies EntryRecord;
const submission = {
  id: 3 as SubmissionId,
  conversationId: 1 as ConversationId,
  type: "input",
  requestId: "old",
  status: "done",
  entry: 2 as EntryId,
  answer: 4 as EntryId,
} satisfies SubmissionRecord;

it("新条目优先于旧关联且保留原文，旧条目只按回执读取", () => {
  const state = AgentChatDoc.definition.initial(null);
  const legacy = { ...input, message: { text: "旧输入", attachments: [] } };
  state.inputs.old = legacy;
  expect(read_agent_input(entry, submission, state)).toEqual(input);
  expect(read_agent_input(entry, undefined, state)?.message.text).toBe(" 原始输入 ");
  expect(read_agent_input({ ...entry, kind: "pi.user" }, submission, state)).toEqual(legacy);
  expect(read_agent_input(undefined, undefined, state)).toBeUndefined();
});

it.each([
  null,
  [],
  { ...input, roundId: "" },
  { ...input, delivery: "unknown" },
  { ...input, queuedId: 1 },
  { ...input, message: { text: "损坏附件", attachments: [{}] } },
])("损坏的新输入元数据不能回退到旧资料：%j", (data) => {
  const state = AgentChatDoc.definition.initial(null);
  state.inputs.old = input;
  expect(() => read_agent_input({ ...entry, data }, submission, state)).toThrow(
    expect.objectContaining({ code: "file.invalid_structure" }),
  );
});

it("旧版产品文档读取时保留对话事实，压缩时间索引从空记录开始", async () => {
  const oldDoc = defineDocFamily<Omit<AgentChatData, "compactionStartedAt">, null>({
    kind: AgentChatDoc.definition.kind,
    version: 1,
    scope: "session",
    family: true,
    initial: () => {
      const { compactionStartedAt: _times, ...state } = AgentChatDoc.definition.initial(null);
      return state;
    },
  });
  // 文档版本转换由真实 `Harness` 执行，磁盘重开由 `AgentChat` 的持久化测试覆盖。
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  try {
    await harness.commit(async (tx) => {
      const state = await tx.doc(oldDoc, "migration-chat", null);
      state.seeded = true;
      state.doing = "保留任务";
    }, BACKGROUND_CONTEXT);
    expect(
      await harness.snapshot(AgentChatDoc, "migration-chat", BACKGROUND_CONTEXT),
    ).toMatchObject({
      seeded: true,
      doing: "保留任务",
      compactionStartedAt: {},
    });
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
});
