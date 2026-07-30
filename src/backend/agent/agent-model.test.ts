import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { resolve_agent_model, resolve_pi_api } from "./agent-model";

const stream_mock = vi.hoisted(() => vi.fn<StreamFn>(() => ({}) as never));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({ streamSimple: stream_mock }),
}));

const TEST_USER_AGENT = "LinguaGacha/Test";

beforeEach(() => {
  stream_mock.mockClear();
});

describe("Agent 模型桥接", () => {
  it.each([
    ["OpenAI", "openai", "openai-completions"],
    ["SakuraLLM", "openai-compatible", "openai-completions"],
    ["Anthropic", "anthropic", "anthropic-messages"],
    ["Google", "google", "google-generative-ai"],
  ] as const)("把 %s 映射到 pi API", (api_format, provider, api) => {
    expect(resolve_pi_api(api_format)).toMatchObject({ provider, api });
  });

  it("统一归一模型事实并固定 Agent 容量，不注入 OneShot 小参数", async () => {
    const resolved = resolve_agent_model(
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
      contextWindow: 256_000,
      maxTokens: 64_000,
      headers: {
        "User-Agent": TEST_USER_AGENT,
        "X-Test": "yes",
        "X-Number": "7",
      },
    });

    const options = read_stream_options(resolved);
    expect(options).toMatchObject({ apiKey: "secret-1" });
    expect(options).not.toHaveProperty("maxTokens");
    expect(options).not.toHaveProperty("temperature");
    expect(options).not.toHaveProperty("top_p");
    expect(options).not.toHaveProperty("presence_penalty");
    expect(options).not.toHaveProperty("frequency_penalty");
    if (options.onPayload === undefined) throw new Error("Agent 缺少 provider payload hook");
    const payload = await options.onPayload(
      { messages: [], reasoning_effort: "medium" },
      resolved.model,
    );
    expect(payload).toMatchObject({ max_tokens: 123, reasoning_effort: "high" });
  });

  it("未知模型不猜测思考能力，禁用的扩展配置也不进入 Agent", async () => {
    const resolved = resolve_agent_model(
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
    expect(resolved.model.headers).toEqual({ "User-Agent": TEST_USER_AGENT });
    const options = read_stream_options(resolved);
    if (options.onPayload === undefined) throw new Error("Agent 缺少 provider payload hook");
    expect(await options.onPayload({ messages: [] }, resolved.model)).toEqual({ messages: [] });
  });

  it("Agent 使用统一 policy 归一后的模型 URL", () => {
    const resolved = resolve_agent_model(build_config("SakuraLLM"), TEST_USER_AGENT);

    expect(resolved.model).toMatchObject({
      api: "openai-completions",
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
    });
  });
});

type ResolvedAgentModel = ReturnType<typeof resolve_agent_model>;

/** 触发一次 Pi 桥接并读取交给底层 stream 的最终 options。 */
function read_stream_options(resolved: ResolvedAgentModel): SimpleStreamOptions {
  const context: Context = { messages: [] };
  void resolved.stream(resolved.model, context, {});
  const options = stream_mock.mock.calls.at(-1)?.[2] as SimpleStreamOptions | undefined;
  if (options === undefined) throw new Error("Pi streamSimple 未收到 options");
  return options;
}

/** 构造只包含 Agent 模型解析所需字段的设置快照。 */
function build_config(api_format: string, overrides: JsonRecord = {}): JsonRecord {
  return {
    activate_model_id: "active",
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
