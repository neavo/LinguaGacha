import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineExtension,
  defineTool,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { ProjectDatabase } from "../database/database-operations";
import type { AgentChatStorage } from "../database/agent-chat-storage";
import { AgentChat, type AgentExecution } from "./agent-chat";
import { AgentChatDoc } from "./agent-chat-data";
import { AgentRuntimeLog } from "./agent-runtime-log";

/** 隔离远程流，事务、提交订阅与历史投影使用真实 Harness。 */
async function create_chat() {
  // 预留窗口，避免 fake 缓存计量差异提前触发自动压缩。
  const provider = fauxProvider({ models: [{ id: "chat-model", contextWindow: 256_000 }] });
  const models = createModels();
  models.setProvider(provider.provider);
  const chat = await AgentChat.open({
    chatId: "chat-test",
    storage: new MemoryStorage(),
    cwd: process.cwd(),
    models,
    seed: [
      { role: "user", content: "种子输入" },
      { role: "assistant", content: "种子回答" },
    ],
    tools: [],
    systemPrompt: () => "测试系统指令",
    skillsPrompt: () => "",
    continueText: () => "继续",
    log: new AgentRuntimeLog({ append: vi.fn() }, "chat-test"),
    onChange: vi.fn(),
    onModelEvent: vi.fn(),
    onReport: vi.fn(),
    onCompactionFailure: vi.fn(),
  });
  onTestFinished(() => chat.close());
  await chat.configure(provider.getModel(), "off");
  return { chat, provider };
}

it("种子进入模型历史，公开时间线从真实输入开始", async () => {
  const { chat, provider } = await create_chat();
  const respond = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("完成"));
  provider.setResponses([respond]);
  await talk(chat, "正文");
  const messages = respond.mock.calls[0]![0].messages.filter(
    (message) => message.role !== "system",
  );
  expect(messages).toMatchObject([
    { role: "user", content: "种子输入" },
    { role: "assistant", content: [{ type: "text", text: "种子回答" }] },
    { role: "user", content: [{ type: "text", text: "正文" }] },
  ]);
  expect(chat.entries).toMatchObject([
    { kind: "user_message", text: "正文" },
    { kind: "assistant_message", parts: [{ kind: "text", text: "完成" }] },
  ]);
});

it("队列事务失败完整回滚，读出的副本无法修改已提交事实", async () => {
  const { chat } = await create_chat();
  const queued = await chat.change_queue((queue) =>
    queue.enqueue({ text: "保留", attachments: [] }),
  );
  const before = chat.queue.read_snapshot(false);
  await expect(
    chat.change_queue((queue) => {
      queue.delete(queued.id);
      queue.enqueue({ text: "回滚", attachments: [] });
      throw new Error("提交失败");
    }),
  ).rejects.toThrow("提交失败");
  chat.queue.delete(queued.id);
  queued.text = "外部改写";
  expect(chat.queue.read_snapshot(false)).toEqual(before);
});

it("供应商身份在修订后改变，同一分支的生成和压缩共用身份", async () => {
  const { chat, provider } = await create_chat();
  const respond = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("完成"));
  provider.setResponses([respond, respond, respond]);
  // 两轮历史超过近期保留预算，使手动压缩实际请求模型。
  const history = "history ".repeat(16_000);
  await talk(chat, history);
  await chat.revise(chat.entries.at(-1)!, "修订回答");
  const execution = await talk(chat, history);
  expect(await chat.compact("manual", execution)).toBe(true);
  expect(respond).toHaveBeenCalledTimes(3);
  const ids = respond.mock.calls.map(([, options]) => options?.sessionId);
  expect(ids[0]).toEqual(expect.any(String));
  expect(ids[0]).not.toBe("chat-test");
  expect(ids[1]).not.toBe(ids[0]);
  expect(ids[2]).toBe(ids[1]);
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** 用真实工程文件验证关闭后重开，避免内存存储掩盖持久化问题。 */
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-chat-"));
  roots.push(root);
  const file = path.join(root, "project.lg");
  const database = new ProjectDatabase();
  database.create_project(file, "持久化");
  return { database, file };
}
/** 以无模型配置打开历史，模型只在新指令前注册。 */
async function open(store: AgentChatStorage) {
  const provider = fauxProvider();
  const models = createModels();
  const append = vi.fn();
  const chat = await AgentChat.open({
    chatId: (await store.read())!.id,
    storage: await store.open_storage(),
    cwd: process.cwd(),
    models,
    seed: [],
    tools: [],
    systemPrompt: () => "",
    skillsPrompt: () => "",
    continueText: () => "继续",
    log: new AgentRuntimeLog({ append }, "chat-test"),
    onChange: vi.fn(),
    onModelEvent: vi.fn(),
    onReport: (error) => {
      throw error;
    },
    onCompactionFailure: vi.fn(),
  });
  return { chat, provider, models, append };
}
/** 经产品轮次入口提交并结算，供内存与磁盘场景共用。 */
async function talk(chat: AgentChat, text: string) {
  const execution: AgentExecution = {
    controller: new AbortController(),
    lease: { owner: "agent" },
    roundId: null,
    phase: "running",
    acceptance: null,
    settlement: null,
    recoveryUsed: false,
    recoveryTask: null,
    steer: null,
    retrySteer: null,
    translationPaused: null,
  };
  chat.execution = execution;
  const input = await chat.submit(
    { text, attachments: [] },
    { text, images: [] },
    execution,
    "round",
  );
  await chat.run(input, execution);
  await chat.finish_round(execution, "success", null);
  chat.execution = null;
  return execution;
}

it("既有身份重开恢复历史，无模型时可修订助手，后续请求采用修订内容", async () => {
  const { database, file } = project();
  let store = database.open_agent_store(file);
  await store.create("-t75szF5");
  const first = await open(store);
  first.models.setProvider(first.provider.provider);
  await first.chat.configure(first.provider.getModel(), "off");
  first.provider.setResponses([fauxAssistantMessage("原回答")]);
  await talk(first.chat, "问题");
  const assistant = first.chat.entries.find((entry) => entry.kind === "assistant_message")!;
  await first.chat.revise(assistant, "修订回答");
  await first.chat.change_queue((queue) => queue.enqueue({ text: "待发送", attachments: [] }));
  const expected = structuredClone(first.chat.entries);
  const usage = structuredClone(first.chat.usage);
  await first.chat.close();
  await store.close();
  store = database.open_agent_store(file);
  const restored = await open(store);
  expect(restored.chat.entries).toEqual(expected);
  expect(restored.chat.usage).toEqual(usage);
  expect(restored.chat.queue.read_snapshot(false).items).toEqual([]);
  expect(restored.provider.state.callCount).toBe(0);
  await restored.chat.revise(restored.chat.entries.at(-1)!, "离线修订");
  expect(restored.chat.usage).toEqual(usage);
  restored.models.setProvider(restored.provider.provider);
  await restored.chat.configure(restored.provider.getModel(), "off");
  const respond = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("继续回答"));
  restored.provider.setResponses([respond]);
  await talk(restored.chat, "继续");
  expect(restored.chat.entries).toContainEqual(
    expect.objectContaining({ kind: "user_message", text: "继续" }),
  );
  expect(respond.mock.calls[0]![0].messages).toContainEqual(
    expect.objectContaining({
      role: "assistant",
      content: [{ type: "text", text: "离线修订" }],
      api: first.provider.getModel().api,
      provider: first.provider.getModel().provider,
      model: first.provider.getModel().id,
      usage: expect.objectContaining({ totalTokens: 0 }),
    }),
  );
  await restored.chat.close();
  await store.close();
  database.close();
});

it("供应商身份随 SQLite 重开和模型重新配置保留", async () => {
  const { database, file } = project();
  const store = database.open_agent_store(file);
  await store.create("identity-chat");
  const first = await open(store);
  first.models.setProvider(first.provider.provider);
  await first.chat.configure(first.provider.getModel(), "off");
  const before = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("第一次"));
  first.provider.setResponses([before]);
  await talk(first.chat, "开始");
  await first.chat.close();
  await store.close();
  const reopenedStore = database.open_agent_store(file);
  const restored = await open(reopenedStore);
  try {
    restored.models.setProvider(restored.provider.provider);
    await restored.chat.configure(restored.provider.getModel(), "off");
    const after = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("继续"));
    restored.provider.setResponses([after]);
    await talk(restored.chat, "重开后继续");
    expect(after.mock.calls[0]![1]?.sessionId).toBe(before.mock.calls[0]![1]?.sessionId);
    expect(after.mock.calls[0]![1]?.sessionId).toEqual(expect.any(String));
  } finally {
    await restored.chat.close();
    await reopenedStore.close();
    database.close();
  }
});

it("压缩条目只依赖 SDK 任务，重开保留身份顺序和状态，关闭冲刷待写日志", async () => {
  const { database, file } = project();
  const store = database.open_agent_store(file);
  await store.create("compaction-chat");
  const first = await open(store);
  let restored: Awaited<ReturnType<typeof open>> | undefined;
  try {
    first.models.setProvider(first.provider.provider);
    await first.chat.configure(first.provider.getModel(), "off");
    first.provider.setResponses([
      fauxAssistantMessage("回答一"),
      fauxAssistantMessage("回答二"),
      fauxAssistantMessage("摘要"),
    ]);
    const history = "history ".repeat(16_000);
    await talk(first.chat, history);
    const execution = await talk(first.chat, history);
    await first.chat.compact("manual", execution);
    const expected = first.chat.entries.map(({ kind, id, status }) => ({ kind, id, status }));
    const compacted = first.chat.entries.filter((entry) => entry.kind === "context_compaction");
    expect(compacted.length).toBeGreaterThan(0);
    for (const entry of compacted)
      expect(entry).toEqual({
        kind: "context_compaction",
        id: expect.any(String),
        status: "success",
      });
    first.chat.log.begin_run("closing-round", "prompt");
    await first.chat.close();
    expect(first.append).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ event: "run_start", round_id: "closing-round" }),
      }),
    );
    restored = await open(store);
    expect(restored.chat.entries.map(({ kind, id, status }) => ({ kind, id, status }))).toEqual(
      expected,
    );
    expect(restored.provider.state.callCount).toBe(0);
  } finally {
    await restored?.chat.close();
    await first.chat.close();
    await store.close();
    database.close();
  }
});

it("遗留工具任务只执行 SDK 取消收尾，恢复后保留公开工具条目且不重跑", async () => {
  const { database, file } = project();
  const store = database.open_agent_store(file);
  await store.create("session1");
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  provider.setResponses([
    fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
  ]);
  const started = Promise.withResolvers<void>();
  const execute = vi.fn(async (_params, _api, context) => {
    started.resolve();
    await new Promise<void>((_resolve, reject) =>
      context.abortSignal.addEventListener("abort", () => reject(new Error("closed")), {
        once: true,
      }),
    );
    return { content: [] };
  });
  const registry = createRegistry();
  registry.install(
    defineExtension({
      name: "test",
      tools: [
        defineTool({
          name: "hold",
          description: "测试等待",
          parameters: Type.Object({}),
          replay: "unsafe",
          execute,
        }),
      ],
    }),
  );
  const harness = await Harness.open(
    await store.open_storage(),
    { models, registry },
    BACKGROUND_CONTEXT,
  );
  const conversation = await harness.root(BACKGROUND_CONTEXT, {
    agent: { model: { provider: provider.getModel().provider, modelId: provider.getModel().id } },
    init: async (tx, id) => {
      const state = await tx.doc(AgentChatDoc, "session1", null);
      state.activeConversationId = id;
      state.seeded = true;
      state.commands.admitted = {
        kind: "send",
        request: {},
        status: "pending",
        conversationId: id,
        requestId: "request",
      };
      state.commands.unsubmitted = {
        kind: "send",
        request: {},
        status: "pending",
        conversationId: id,
        requestId: "missing",
      };
      const start = await tx.appendEntry(id, { kind: "test.start" });
      state.inputs.request = {
        roundId: "round",
        message: { text: "执行工具", attachments: [] },
        delivery: "round",
        queuedId: null,
      };
      state.rounds.round = {
        checkpoint: start.id,
        status: "running",
        endedAt: null,
        averageTokensPerSecond: null,
      };
    },
  });
  await conversation.submit(
    { type: "input", content: "执行工具", requestId: "request" },
    BACKGROUND_CONTEXT,
  );
  await started.promise;
  // Harness.close 停止进程内调用但保留任务检查点，模拟进程退出留下的持久化状态。
  await harness.close(BACKGROUND_CONTEXT);
  const restored = await open(store);
  expect(execute).toHaveBeenCalledOnce();
  expect(restored.chat.state.commands.admitted?.status).toBe("accepted");
  expect(restored.chat.state.commands.unsubmitted?.status).toBe("cancelled");
  expect(restored.provider.state.callCount).toBe(0);
  expect(restored.chat.entries).toContainEqual(
    expect.objectContaining({ kind: "tool_call", status: "stopped", output: expect.any(Array) }),
  );
  expect(restored.chat.entries).toContainEqual(
    expect.objectContaining({ kind: "user_message", status: "stopped" }),
  );
  await restored.chat.close();
  await store.close();
  database.close();
});
