import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  UserEntry,
  AssistantEntry,
  CompactionEntry,
  type EntryDraft,
  type ContextView,
  type EntryId,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { expect, it, onTestFinished } from "vitest";
import {
  AgentContextBudget,
  AGENT_KEEP_RECENT_TOKENS,
  read_agent_chat_context,
} from "./agent-chat-context";

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
async function create_chat() {
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
    read: async () => read_agent_chat_context(await conversation.context(context), model),
  };
}
/** 固定相同时间戳，确保用量边界依靠条目身份。 */
function response(input: number) {
  const result = { ...fauxAssistantMessage("已完成"), timestamp: 0 };
  result.usage = { ...result.usage, input, output: 10, totalTokens: input + 10 };
  return result;
}

it("上下文编辑使旧用量失效，后续响应提供新的有效用量", async () => {
  const chat = await create_chat();
  const input = await chat.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "旧输入".repeat(40_000), timestamp: 0 }],
  });
  await chat.append({ kind: AssistantEntry.kind, model: [response(100_000)] });
  expect((await chat.read()).tokens).toBe(100_010);
  await chat.append({ kind: "test.edit", edits: [{ target: input, action: "omit" }] });
  expect((await chat.read()).tokens).toBeLessThan(1_000);
  await chat.append({ kind: AssistantEntry.kind, model: [response(3_000)] });
  expect((await chat.read()).tokens).toBe(3_010);
});

it("摘要与旧响应同时间戳时重新估算，新输入到来后允许再次压缩", async () => {
  const chat = await create_chat();
  await chat.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "旧历史".repeat(40_000), timestamp: 0 }],
  });
  await chat.append({ kind: AssistantEntry.kind, model: [response(100_000)] });
  const kept = await chat.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "x".repeat(160_000), timestamp: 0 }],
  });
  await chat.append({ kind: AssistantEntry.kind, model: [response(120_000)] });
  await chat.append({
    kind: CompactionEntry.kind,
    head: kept,
    model: [{ role: "user", content: "历史摘要", timestamp: 0 }],
    data: { reason: "manual" },
  });
  const snapshot = await chat.read();
  expect(snapshot.tokens).toBeGreaterThan(AGENT_KEEP_RECENT_TOKENS);
  expect(snapshot.tokens).toBeLessThan(120_000);
  expect(snapshot.compactable).toBe(false);
  await chat.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "继续", timestamp: 1 }],
  });
  expect((await chat.read()).compactable).toBe(true);
});

it("动态保留预算让高 usage、低字符估算的历史由真实 SDK 自动压缩并继续", async () => {
  const budget = new AgentContextBudget();
  const provider = fauxProvider({ models: [{ id: "test", contextWindow: 64_000 }] });
  const models = createModels();
  models.setProvider(provider.provider);
  const harness = await Harness.open(
    new MemoryStorage(),
    {
      models,
      registry: createRegistry(),
      settings: {
        compaction: {
          enabled: true,
          reserveTokens: 32_000,
          backgroundTokens: 0,
          get keepRecentTokens() {
            return budget.keepRecentTokens;
          },
        },
      },
    },
    context,
  );
  onTestFinished(() => harness.close(context));
  const conversation = await harness.root(context);
  const active = provider.getModel();
  await conversation.configure(
    { model: { provider: active.provider, modelId: active.id } },
    context,
  );
  for (const text of ["旧历史", "最近历史"])
    await conversation.commit(
      (tx) =>
        tx.appendEntry(conversation.id, {
          kind: UserEntry.kind,
          model: [
            {
              role: "user",
              content: text.repeat(text === "最近历史" ? 16_000 : 10_000),
              timestamp: 0,
            },
          ],
        }),
      context,
    );
  const message = { ...response(55_000), model: active.id, provider: active.provider };
  await conversation.commit(
    (tx) => tx.appendEntry(conversation.id, { kind: AssistantEntry.kind, model: [message] }),
    context,
  );
  const view = await conversation.context(context);
  expect(read_agent_chat_context(view, active).compactable).toBe(false);
  budget.restore(view, null, conversation.id);
  expect(read_agent_chat_context(view, active, budget.keepRecentTokens).compactable).toBe(true);
  provider.setResponses([fauxAssistantMessage("摘要"), fauxAssistantMessage("继续完成")]);
  const submitted = await conversation.submit({ type: "input", content: "继续" }, context);
  expect((await submitted.wait(context)).status).toBe("done");
  const after = await conversation.context(context);
  expect(after.head?.kind).toBe(CompactionEntry.kind);
  expect(after.messages.at(-1)?.content).toEqual(
    expect.arrayContaining([expect.objectContaining({ text: "继续完成" })]),
  );
});

it("比例按请求配对更新，截断保留旧比例，同模型配置保留而换模型重置", () => {
  const budget = new AgentContextBudget();
  budget.configure(model);
  budget.before_request(1, [{ role: "user", content: "x".repeat(1000), timestamp: 0 }]);
  budget.after_response(1, response(1000));
  expect(budget.keepRecentTokens).toBeLessThan(AGENT_KEEP_RECENT_TOKENS);
  const kept = budget.keepRecentTokens;
  const sameModel = { ...model, contextWindow: 64_000 };
  budget.configure(sameModel);
  expect(budget.keepRecentTokens).toBe(kept);
  budget.before_request(2, [{ role: "user", content: "短请求", timestamp: 0 }]);
  budget.after_response(2, { ...response(100_000), stopReason: "length" });
  expect(budget.keepRecentTokens).toBe(kept);
  budget.configure({ ...model, id: "other" });
  expect(budget.keepRecentTokens).toBe(AGENT_KEEP_RECENT_TOKENS);
});

it("删除后来的截断响应不会作废较早响应所覆盖的前缀", async () => {
  const chat = await create_chat();
  await chat.append({
    kind: UserEntry.kind,
    model: [{ role: "user", content: "输入", timestamp: 0 }],
  });
  await chat.append({ kind: AssistantEntry.kind, model: [response(50_000)] });
  const truncated = await chat.append({
    kind: AssistantEntry.kind,
    model: [{ ...response(60_000), stopReason: "length" }],
  });
  await chat.append({ kind: "test.edit", edits: [{ target: truncated, action: "omit" }] });
  expect((await chat.read()).tokens).toBe(50_010);
});

it("模型接口切换重置校准，同一分支的迟到快照保留最新比例", () => {
  const budget = new AgentContextBudget();
  const measured = { ...response(1000), model: model.id, provider: model.provider };
  const view: ContextView = {
    head: undefined,
    entries: [
      {
        id: 1 as EntryId,
        conversationId: 1 as ConversationId,
        kind: AssistantEntry.kind,
        model: [measured],
      },
    ],
    contributions: [[measured]],
    messages: [measured],
  };
  budget.restore(view, model, 1);
  budget.before_request(2, [{ role: "user", content: "x".repeat(1000), timestamp: 0 }]);
  budget.after_response(2, response(2000));
  const latest = budget.keepRecentTokens;
  budget.restore(view, model, 1);
  expect(budget.keepRecentTokens).toBe(latest);
  budget.restore(view, { ...model, api: "openai-responses" }, 1);
  expect(budget.keepRecentTokens).toBe(AGENT_KEEP_RECENT_TOKENS);
});
