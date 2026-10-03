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
import type { AgentSessionStore } from "../database/agent-session-store";
import { AgentSession, type AgentExecution } from "./agent-session";
import { AgentSessionDoc } from "./agent-session-state";
import { AgentSessionLog } from "./agent-log";

/** 隔离远程流，事务、提交订阅与历史投影使用真实 Harness。 */
async function create_session() {
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  const session = await AgentSession.open({
    sessionId: "session-test",
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
    log: new AgentSessionLog({ append: vi.fn() }),
    onChange: vi.fn(),
    onModelEvent: vi.fn(),
    onReport: vi.fn(),
    onCompactionFailure: vi.fn(),
  });
  onTestFinished(() => session.close());
  await session.configure(provider.getModel(), "off");
  return { session, provider };
}

it("种子进入模型历史，公开时间线从真实输入开始", async () => {
  const { session, provider } = await create_session();
  const respond = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("完成"));
  provider.setResponses([respond]);
  await talk(session, "正文");
  const messages = respond.mock.calls[0]![0].messages.filter(
    (message) => message.role !== "system",
  );
  expect(messages).toMatchObject([
    { role: "user", content: "种子输入" },
    { role: "assistant", content: [{ type: "text", text: "种子回答" }] },
    { role: "user", content: [{ type: "text", text: "正文" }] },
  ]);
  expect(session.entries).toMatchObject([
    { kind: "user_message", text: "正文" },
    { kind: "assistant_message", parts: [{ kind: "text", text: "完成" }] },
  ]);
});

it("队列事务失败完整回滚，读出的副本无法修改已提交事实", async () => {
  const { session } = await create_session();
  const queued = await session.change_queue((queue) =>
    queue.enqueue({ text: "保留", attachments: [] }),
  );
  const before = session.queue.read_snapshot(false);
  await expect(
    session.change_queue((queue) => {
      queue.delete(queued.id);
      queue.enqueue({ text: "回滚", attachments: [] });
      throw new Error("提交失败");
    }),
  ).rejects.toThrow("提交失败");
  session.queue.delete(queued.id);
  queued.text = "外部改写";
  expect(session.queue.read_snapshot(false)).toEqual(before);
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** 用真实工程文件验证关闭后重开，避免内存存储掩盖持久化问题。 */
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-session-"));
  roots.push(root);
  const file = path.join(root, "project.lg");
  const database = new ProjectDatabase();
  database.create_project(file, "持久化");
  return { database, file };
}
/** 以无模型配置打开历史，模型只在新指令前注册。 */
async function open(store: AgentSessionStore) {
  const provider = fauxProvider();
  const models = createModels();
  const session = await AgentSession.open({
    sessionId: (await store.read())!.id,
    storage: await store.open_storage(),
    cwd: process.cwd(),
    models,
    seed: [],
    tools: [],
    systemPrompt: () => "",
    skillsPrompt: () => "",
    continueText: () => "继续",
    log: new AgentSessionLog({ append: vi.fn() }),
    onChange: vi.fn(),
    onModelEvent: vi.fn(),
    onReport: (error) => {
      throw error;
    },
    onCompactionFailure: vi.fn(),
  });
  return { session, provider, models };
}
/** 经产品轮次入口提交并结算，供内存与磁盘场景共用。 */
async function talk(session: AgentSession, text: string) {
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
  session.execution = execution;
  const input = await session.submit(
    { text, attachments: [] },
    { text, images: [] },
    execution,
    "round",
  );
  await session.run(input, execution);
  await session.finish_round(execution, "success", null);
  session.execution = null;
}

it("既有身份重开恢复历史，无模型时可修订助手，后续请求采用修订内容", async () => {
  const { database, file } = project();
  let store = database.open_agent_store(file);
  await store.create("-t75szF5");
  const first = await open(store);
  first.models.setProvider(first.provider.provider);
  await first.session.configure(first.provider.getModel(), "off");
  first.provider.setResponses([fauxAssistantMessage("原回答")]);
  await talk(first.session, "问题");
  const assistant = first.session.entries.find((entry) => entry.kind === "assistant_message")!;
  await first.session.revise(assistant, "修订回答");
  await first.session.change_queue((queue) => queue.enqueue({ text: "待发送", attachments: [] }));
  const expected = structuredClone(first.session.entries);
  const usage = structuredClone(first.session.usage);
  await first.session.close();
  await store.close();
  store = database.open_agent_store(file);
  const restored = await open(store);
  expect(restored.session.entries).toEqual(expected);
  expect(restored.session.usage).toEqual(usage);
  expect(restored.session.queue.read_snapshot(false).items).toEqual([]);
  expect(restored.provider.state.callCount).toBe(0);
  await restored.session.revise(restored.session.entries.at(-1)!, "离线修订");
  expect(restored.session.usage).toEqual(usage);
  restored.models.setProvider(restored.provider.provider);
  await restored.session.configure(restored.provider.getModel(), "off");
  const respond = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("继续回答"));
  restored.provider.setResponses([respond]);
  await talk(restored.session, "继续");
  expect(restored.session.entries).toContainEqual(
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
  await restored.session.close();
  await store.close();
  database.close();
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
      const state = await tx.doc(AgentSessionDoc, "session1", null);
      state.activeConversationId = id;
      state.seeded = true;
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
  expect(restored.provider.state.callCount).toBe(0);
  expect(restored.session.entries).toContainEqual(
    expect.objectContaining({ kind: "tool_call", status: "stopped" }),
  );
  expect(restored.session.entries).toContainEqual(
    expect.objectContaining({ kind: "user_message", status: "stopped" }),
  );
  await restored.session.close();
  await store.close();
  database.close();
});
