import { InMemoryCredentialStore, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { expect, it, onTestFinished } from "vitest";

import { AGENT_KEEP_RECENT_TOKENS, read_agent_session_context } from "./agent-session-context";

it("上下文编辑使旧用量失效，后续响应提供新的有效用量", async () => {
  const session = await create_session();
  const manager = session.sessionManager;
  const input = manager.appendMessage({
    role: "user",
    content: "旧输入".repeat(40_000),
    timestamp: 0,
  });
  manager.appendMessage(response_with_usage(100_000));
  session.refreshContext();
  expect(read_agent_session_context(session)).toMatchObject({ tokens: 100_010, compactable: true });

  manager.appendContextEdit(input, null);
  // 保留旧的 `agent.state` 缓存，以验证读取结果来自已提交的历史。
  expect(read_agent_session_context(session).tokens).toBeLessThan(1_000);
  manager.appendMessage(response_with_usage(3_000));
  expect(read_agent_session_context(session)).toMatchObject({ tokens: 3_010, compactable: false });
});

it("压缩后按当前内容估算用量，新输入到来后才允许再次压缩", async () => {
  const session = await create_session();
  const manager = session.sessionManager;
  manager.appendMessage({ role: "user", content: "旧历史".repeat(40_000), timestamp: 0 });
  manager.appendMessage(response_with_usage(100_000));
  // 保留量超过产品阈值，让是否允许再次压缩取决于历史边界。
  const kept = manager.appendMessage({ role: "user", content: "x".repeat(160_000), timestamp: 0 });
  manager.appendMessage(response_with_usage(120_000));
  manager.appendCompaction("历史摘要", kept, 120_010);

  const context = read_agent_session_context(session);
  expect(session.getContextUsage()?.tokens).toBeNull();
  expect(context.tokens).toBeGreaterThan(AGENT_KEEP_RECENT_TOKENS);
  expect(context.tokens).toBeLessThan(120_000);
  expect(context.compactable).toBe(false);
  manager.appendMessage({ role: "user", content: "继续", timestamp: 1 });
  expect(read_agent_session_context(session).compactable).toBe(true);
});

/** 真实 SDK 负责历史和 usage 规则，测试会话关闭资源发现且不发起模型请求。 */
async function create_session(): Promise<AgentSession> {
  const cwd = process.cwd();
  const settingsManager = SettingsManager.inMemory({ enableInstallTelemetry: false });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "测试指令",
    appendSystemPrompt: [],
  });
  await resourceLoader.reload();
  const model: Model<"openai-completions"> = {
    id: "context-test",
    name: "context-test",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "http://localhost:0",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 288_000,
    maxTokens: 32_000,
  };
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime: await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
    }),
    noTools: "all",
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
  });
  onTestFinished(() => session.dispose());
  return session;
}

/** 为短回复指定独立用量，以区分供应商统计和内容估算。 */
function response_with_usage(input: number) {
  const response = fauxAssistantMessage("已完成");
  response.usage = { ...response.usage, input, output: 10, totalTokens: input + 10 };
  return response;
}
