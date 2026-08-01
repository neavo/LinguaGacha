import { InMemoryCredentialStore, type Context, type ProviderStreams } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import type { ModelApiFormat } from "../../domain/model";
import { register_agent_model } from "./agent-model";

const api_mocks = vi.hoisted(() => ({
  streamSimple: vi.fn<ProviderStreams["streamSimple"]>(() => ({}) as never),
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ streamSimple: api_mocks.streamSimple }),
}));

vi.mock("@earendil-works/pi-ai/api/openai-responses.lazy", () => ({
  openAIResponsesApi: () => ({ streamSimple: api_mocks.streamSimple }),
}));

const TEST_USER_AGENT = "LinguaGacha/Test";

beforeEach(() => {
  api_mocks.streamSimple.mockClear();
});

describe("Agent 模型注册", () => {
  it.each([
    ["OpenAI", "openai", "openai-completions", { supportsDeveloperRole: false }],
    ["OpenAIResponses", "openai", "openai-responses", undefined],
    ["SakuraLLM", "openai-compatible", "openai-completions", { supportsDeveloperRole: false }],
    ["Anthropic", "anthropic", "anthropic-messages", undefined],
    ["Google", "google", "google-generative-ai", undefined],
  ] as const)(
    "把 %s 注册为对应 Provider、API 与 developer 角色能力",
    async (api_format, provider, api, compat) => {
      const runtime = await create_model_runtime();
      const resolved = register_agent_model(runtime, build_config(api_format), TEST_USER_AGENT);

      expect(resolved.model).toMatchObject({ provider, api });
      if (compat === undefined) expect(resolved.model).not.toHaveProperty("compat");
      else expect(resolved.model.compat).toEqual(compat);
      expect(runtime.getModels(provider)).toEqual([resolved.model]);
    },
  );

  it("注册统一模型事实，并在 streamSimple 强制 LinguaGacha 请求策略", async () => {
    const runtime = await create_model_runtime();
    const resolved = register_agent_model(
      runtime,
      build_config("OpenAI", {
        api_key: " secret-1 \nsecret-2",
        model_id: "kimi-k3",
        request: {
          extra_headers_custom_enable: true,
          extra_headers: { "X-Test": "yes", "X-Number": 7 },
          extra_body_custom_enable: true,
          extra_body: { max_tokens: 123, reasoning_effort: "high" },
        },
        thinking: { level: "OFF" },
        generation: {
          temperature_custom_enable: true,
          temperature: 0.2,
          top_p_custom_enable: true,
          top_p: 0.8,
        },
        threshold: { input_token_limit: 4096, output_token_limit: 1024 },
      }),
      TEST_USER_AGENT,
    );

    expect(resolved.model).toMatchObject({
      id: "kimi-k3",
      name: "Test",
      reasoning: true,
      contextWindow: 288_000,
      maxTokens: 32_000,
    });
    const provider_config = runtime.getRegisteredProviderConfig("openai");
    expect(provider_config).toMatchObject({
      api: "openai-completions",
      apiKey: "secret-1",
      authHeader: false,
      headers: {
        "User-Agent": TEST_USER_AGENT,
        "X-Test": "yes",
        "X-Number": "7",
      },
      models: [
        expect.objectContaining({
          id: "kimi-k3",
          contextWindow: 288_000,
          maxTokens: 32_000,
        }),
      ],
    });
    expect(await runtime.getAuth(resolved.model)).toMatchObject({
      auth: {
        apiKey: "secret-1",
        headers: {
          "User-Agent": TEST_USER_AGENT,
          "X-Test": "yes",
          "X-Number": "7",
        },
      },
    });
    if (provider_config?.streamSimple === undefined) {
      throw new Error("Agent 缺少 provider streamSimple");
    }

    const signal = new AbortController().signal;
    const context: Context = { messages: [] };
    void provider_config.streamSimple(resolved.model, context, {
      signal,
      reasoning: "high",
      timeoutMs: 5_000,
      maxRetries: 3,
      maxRetryDelayMs: 6_000,
      headers: { "X-SDK-Injected": "yes" },
    });

    const options = api_mocks.streamSimple.mock.calls.at(-1)?.[2];
    expect(options).toMatchObject({
      signal,
      reasoning: "high",
      timeoutMs: 5_000,
      maxRetries: 3,
      maxRetryDelayMs: 6_000,
      apiKey: "secret-1",
      headers: {
        "User-Agent": TEST_USER_AGENT,
        "X-Test": "yes",
        "X-Number": "7",
      },
    });
    expect(options?.headers).not.toHaveProperty("X-SDK-Injected");
    expect(options).not.toHaveProperty("temperature");
    if (options?.onPayload === undefined) throw new Error("Agent 缺少 provider payload hook");
    const payload = await options.onPayload(
      { messages: [], reasoning_effort: "medium" },
      resolved.model,
    );
    expect(payload).toMatchObject({ max_tokens: 123, reasoning_effort: "high" });
  });

  it("换模时使用当前对话冻结的容量而不读取新模型容量", async () => {
    const runtime = await create_model_runtime();
    const resolved = register_agent_model(
      runtime,
      build_config("OpenAI", {
        agent: { context_window: 400_000, max_output_tokens: 50_000 },
      }),
      TEST_USER_AGENT,
      { contextWindow: 288_000, maxTokens: 32_000 },
    );

    expect(resolved.model).toMatchObject({ contextWindow: 288_000, maxTokens: 32_000 });
  });

  it("GPT-5.6 Responses 按项目规则注册为 reasoning 模型", async () => {
    const runtime = await create_model_runtime();
    const resolved = register_agent_model(
      runtime,
      build_config("OpenAIResponses", {
        model_id: "gpt-5.6-luna",
        thinking: { level: "HIGH" },
        request: {
          extra_headers_custom_enable: false,
          extra_body_custom_enable: true,
          extra_body: { custom_flag: true },
        },
      }),
      TEST_USER_AGENT,
    );

    expect(resolved.model).toMatchObject({ api: "openai-responses", reasoning: true });
    expect(resolved.thinkingLevel).toBe("high");
    const provider_config = runtime.getRegisteredProviderConfig("openai");
    if (provider_config?.streamSimple === undefined) {
      throw new Error("Agent 缺少 Responses streamSimple");
    }
    void provider_config.streamSimple(resolved.model, { messages: [] }, { reasoning: "high" });
    const options = api_mocks.streamSimple.mock.calls.at(-1)?.[2];
    expect(options).toMatchObject({ reasoning: "high" });
    if (options?.onPayload === undefined) throw new Error("Agent 缺少 Responses payload hook");
    expect(
      options.onPayload(
        {
          input: [
            { role: "system", content: "系统约束" },
            { role: "user", content: "用户输入" },
          ],
          reasoning: { effort: "high" },
          store: false,
        },
        resolved.model,
      ),
    ).toEqual({
      input: [
        { role: "developer", content: "系统约束" },
        { role: "user", content: "用户输入" },
      ],
      reasoning: { effort: "high" },
      store: false,
      custom_flag: true,
    });
  });

  it("Responses 未收录模型不启用 reasoning", async () => {
    const runtime = await create_model_runtime();
    const resolved = register_agent_model(
      runtime,
      build_config("OpenAIResponses", {
        model_id: "custom-reasoning-model",
        thinking: { level: "HIGH" },
      }),
      TEST_USER_AGENT,
    );

    expect(resolved.model.reasoning).toBe(false);
  });

  it("未知模型不猜测思考能力，禁用的扩展配置也不进入 Agent", async () => {
    const runtime = await create_model_runtime();
    const resolved = register_agent_model(
      runtime,
      build_config("OpenAI", {
        model_id: "unknown-model",
        thinking: { level: "HIGH" },
        request: {
          extra_headers_custom_enable: false,
          extra_headers: { "X-Disabled": "no" },
          extra_body_custom_enable: false,
          extra_body: { custom_flag: true },
        },
      }),
      TEST_USER_AGENT,
    );

    expect(resolved.model.reasoning).toBe(false);
    expect(resolved.thinkingLevel).toBe("high");
    const provider_config = runtime.getRegisteredProviderConfig("openai");
    expect(provider_config?.headers).toEqual({ "User-Agent": TEST_USER_AGENT });
    if (provider_config?.streamSimple === undefined) {
      throw new Error("Agent 缺少 provider streamSimple");
    }
    void provider_config.streamSimple(resolved.model, { messages: [] });
    const options = api_mocks.streamSimple.mock.calls.at(-1)?.[2];
    if (options?.onPayload === undefined) throw new Error("Agent 缺少 provider payload hook");
    expect(await options.onPayload({ messages: [] }, resolved.model)).toEqual({ messages: [] });
  });

  it("Agent 使用统一 policy 归一后的模型 URL", async () => {
    const runtime = await create_model_runtime();
    const resolved = register_agent_model(runtime, build_config("SakuraLLM"), TEST_USER_AGENT);

    expect(resolved.model).toMatchObject({
      api: "openai-completions",
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
    });
  });

  it("Agent 只读取 agent 用途选择", async () => {
    const config = build_config("OpenAI");
    const models = config["models"];
    if (!Array.isArray(models)) throw new Error("测试配置缺少模型");
    config["models"] = [
      {
        id: "task-model",
        api_format: "OpenAI",
        api_url: "https://task.example/v1",
        api_key: "task-key",
        model_id: "task-only",
      },
      ...models,
    ];
    const runtime = await create_model_runtime();

    expect(register_agent_model(runtime, config, TEST_USER_AGENT).model.id).toBe("test-model");
  });
});

async function create_model_runtime(): Promise<ModelRuntime> {
  return await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
}

/** 构造只包含 Agent 模型解析所需字段的设置快照。 */
function build_config(api_format: ModelApiFormat, overrides: JsonRecord = {}): JsonRecord {
  return {
    model_selection: { translation: "translation", analysis: "analysis", agent: "active" },
    models: [
      {
        id: "active",
        name: "Test",
        api_format,
        api_url: "https://example.test/v1/chat/completions/",
        api_key: "secret",
        model_id: "test-model",
        request: {
          extra_body_custom_enable: false,
          extra_headers_custom_enable: false,
        },
        thinking: { level: "OFF" },
        generation: {},
        threshold: { input_token_limit: 4096, output_token_limit: 1024 },
        ...overrides,
      },
    ],
  };
}
