import { createModels } from "@earendil-works/pi-ai";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineDocFamily,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { expect, it } from "vitest";
import { AgentChatDoc, type AgentChatData } from "./agent-chat-data";

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
