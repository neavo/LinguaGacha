import { createModels, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  UserEntry,
  AssistantEntry,
  CompactionEntry,
  type EntryDraft,
} from "@earendil-works/pi-durable";
import { expect, it, onTestFinished } from "vitest";
import { AGENT_KEEP_RECENT_TOKENS, read_agent_session_context } from "./agent-session-context";

const model: Model<"openai-completions"> = {
  id: "test",
  name: "test",
  api: "openai-completions",
  provider: "test",
  baseUrl: "http://localhost:0",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 288_000,
  maxTokens: 32_000,
};
/** 用真实上下文编辑与压缩验证条目边界，关闭 Harness 回收任务。 */
async function create_session() {
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: createModels(), registry: createRegistry() },
    context,
  );
  const conversation = await harness.root(context);
  onTestFinished(() => harness.close(context));
  return {
    append: async (entry: EntryDraft) =>
      (await conversation.commit((tx) => tx.appendEntry(conversation.id, entry), context)).id,
    read: async () => read_agent_session_context(await conversation.context(context), model),
  };
}
/** 固定相同时间戳，确保用量边界依靠条目身份。 */
function response(input: number) {
  const result = { ...fauxAssistantMessage("已完成"), timestamp: 0 };
  result.usage = { ...result.usage, input, output: 10, totalTokens: input + 10 };
  return result;
}

it("上下文编辑使旧用量失效，后续响应提供新的有效用量", async () => {
  const session = await create_session();
  const input = await session.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "旧输入".repeat(40_000), timestamp: 0 }],
  });
  await session.append({ kind: AssistantEntry.kind, model: [response(100_000)] });
  expect(await session.read()).toMatchObject({ tokens: 100_010, compactable: true });
  await session.append({ kind: "test.edit", edits: [{ target: input, action: "omit" }] });
  expect((await session.read()).tokens).toBeLessThan(1_000);
  await session.append({ kind: AssistantEntry.kind, model: [response(3_000)] });
  expect(await session.read()).toMatchObject({ tokens: 3_010, compactable: false });
});

it("摘要与旧响应同时间戳时重新估算，新输入到来后允许再次压缩", async () => {
  const session = await create_session();
  await session.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "旧历史".repeat(40_000), timestamp: 0 }],
  });
  await session.append({ kind: AssistantEntry.kind, model: [response(100_000)] });
  const kept = await session.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "x".repeat(160_000), timestamp: 0 }],
  });
  await session.append({ kind: AssistantEntry.kind, model: [response(120_000)] });
  await session.append({
    kind: CompactionEntry.kind,
    head: kept,
    model: [{ role: "user", content: "历史摘要", timestamp: 0 }],
    data: { reason: "manual" },
  });
  const snapshot = await session.read();
  expect(snapshot.tokens).toBeGreaterThan(AGENT_KEEP_RECENT_TOKENS);
  expect(snapshot.tokens).toBeLessThan(120_000);
  expect(snapshot.compactable).toBe(false);
  await session.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "继续", timestamp: 1 }],
  });
  expect((await session.read()).compactable).toBe(true);
});
