import { Type, type Model, type ProviderStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import { is_json_record, type JsonRecord } from "../../domain/json";
import { read_model_request_snapshot } from "./llm-client-policy";
import { match_pi_catalog_model, resolve_one_shot_pi_request, resolve_pi_model } from "./llm-pi";

const TEST_USER_AGENT = "LinguaGacha/Test";

describe("pi-ai 请求适配", () => {
  it("catalog 匹配优先精确项，否则选择最长且唯一的包含项", () => {
    const catalog = [
      create_catalog_model("gemini-3"),
      create_catalog_model("gemini-3.6-flash"),
      create_catalog_model("model-alpha"),
      create_catalog_model("model-bravo"),
    ];

    expect(match_pi_catalog_model("GEMINI-3", catalog)?.id).toBe("gemini-3");
    expect(match_pi_catalog_model("vendor/gemini-3.6-flash:free", catalog)?.id).toBe(
      "gemini-3.6-flash",
    );
    expect(match_pi_catalog_model("model-alpha+model-bravo", catalog)).toBeNull();
    expect(match_pi_catalog_model("provider-defined-model", catalog)).toBeNull();
  });

  it.each([
    ["OpenAI", "openai", "openai-completions"],
    ["OpenAIResponses", "openai", "openai-responses"],
    ["SakuraLLM", "openai-compatible", "openai-completions"],
    ["Anthropic", "anthropic", "anthropic-messages"],
    ["Google", "google", "google-generative-ai"],
  ] as const)("把 %s 映射到 %s/%s", (api_format, provider, api) => {
    const snapshot = read_model_request_snapshot(create_model({ api_format }), TEST_USER_AGENT);
    const resolved = resolve_pi_model(snapshot, {
      name: "Test",
      contextWindow: 32_000,
      maxTokens: 4096,
      input: ["text"],
    });

    expect(resolved.model).toMatchObject({ provider, api, name: "Test" });
  });

  it("Google adapter 使用进程 HTTP transport", async () => {
    const original_fetch = globalThis.fetch;
    const process_fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 500, message: "fake upstream" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = process_fetch;
    try {
      const snapshot = read_model_request_snapshot(
        create_model({
          api_format: "Google",
          api_url: "https://google.example/v1beta",
          model_id: "gemini-2.5-flash",
        }),
        TEST_USER_AGENT,
      );
      const request = resolve_one_shot_pi_request(
        snapshot,
        [{ role: "user", content: "ping" }],
        new AbortController().signal,
      );

      await request.stream(request.model, request.context, request.options).result();

      expect(process_fetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original_fetch;
    }
  });

  it("在协议转换前拒绝空业务提示词", () => {
    const snapshot = read_model_request_snapshot(
      create_model({ api_format: "OpenAIResponses" }),
      TEST_USER_AGENT,
    );

    expect(() =>
      resolve_one_shot_pi_request(
        snapshot,
        [{ role: "user", content: "   " }],
        new AbortController().signal,
      ),
    ).toThrow("request.validation_failed");
  });

  it("让 Pi 构造 OpenAI payload，再应用当前生成、思考和 extra_body 规则", async () => {
    const request = resolve_request({
      api_format: "OpenAI",
      api_url: "https://openai.example/v1/chat/completions",
      model_id: "gpt-5-mini",
      generation: {
        temperature_custom_enable: true,
        temperature: 0.2,
        top_p_custom_enable: true,
        top_p: 0.9,
      },
      request: {
        extra_headers_custom_enable: true,
        extra_headers: { "X-Test": "yes" },
        extra_body_custom_enable: true,
        extra_body: { custom_flag: true },
      },
      thinking: { level: "HIGH" },
    });
    const payload = await capture_payload(request);

    expect(request.model).toMatchObject({
      provider: "openai",
      api: "openai-completions",
      baseUrl: "https://openai.example/v1",
      reasoning: true,
      input: ["text"],
      compat: {
        supportsDeveloperRole: false,
        supportsStore: false,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
      },
    });
    expect(request.options).toMatchObject({
      apiKey: "key",
      cacheRetention: "none",
      maxRetries: 0,
      temperature: 0.2,
      maxTokens: 4096,
      headers: { "User-Agent": TEST_USER_AGENT, "X-Test": "yes" },
    });
    expect(request.options).not.toHaveProperty("timeoutMs");
    expect(payload).toMatchObject({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "系统约束" },
        { role: "user", content: "こんにちは" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 4096,
      top_p: 0.9,
      reasoning_effort: "high",
      custom_flag: true,
    });
  });

  it("Sakura 复用 OpenAI wire payload 且不注入模型族 thinking", async () => {
    const request = resolve_request({
      api_format: "SakuraLLM",
      model_id: "gpt-5-mini",
      generation: { top_p_custom_enable: true, top_p: 0.8 },
      thinking: { level: "HIGH" },
      request: {
        extra_headers_custom_enable: false,
        extra_body_custom_enable: true,
        extra_body: { custom_flag: true },
      },
    });
    const payload = await capture_payload(request);

    expect(request.model.provider).toBe("openai-compatible");
    expect(payload).toMatchObject({ top_p: 0.8, custom_flag: true });
    expect(payload).not.toHaveProperty("reasoning_effort");
    expect(payload).not.toHaveProperty("thinking");
  });

  it("非推理 Responses 由 Pi 生成 Items，且不注入 reasoning", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      api_url: "https://openai.example/v1/responses/",
      model_id: "custom-model",
      generation: {
        temperature_custom_enable: true,
        temperature: 0.2,
        top_p_custom_enable: true,
        top_p: 0.9,
      },
      thinking: { level: "OFF" },
    });
    const payload = await capture_payload(request);

    expect(request.model).toMatchObject({
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://openai.example/v1",
      reasoning: false,
    });
    expect(request.model).not.toHaveProperty("compat");
    expect(request.options).toMatchObject({ temperature: 0.2, maxTokens: 4096 });
    expect(request.options).not.toHaveProperty("reasoningEffort");
    expect(payload).toMatchObject({
      model: "custom-model",
      input: expect.any(Array),
      stream: true,
      store: false,
      temperature: 0.2,
      max_output_tokens: 4096,
      top_p: 0.9,
    });
    expect(payload["input"]).toEqual([
      { role: "developer", content: "系统约束" },
      {
        role: "user",
        content: [{ type: "input_text", text: "こんにちは" }],
      },
    ]);
    expect(payload).not.toHaveProperty("messages");
    expect(payload).not.toHaveProperty("max_tokens");
    expect(payload).not.toHaveProperty("reasoning");
  });

  it("Responses 原样发送工具 parameters 且默认 strict=false", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      model_id: "custom-model",
    });
    request.model.compat = { supportsStrictMode: true };
    const parameters = Type.Object({ value: Type.String() }, { additionalProperties: false });
    request.context.tools = [{ name: "probe", description: "探针工具", parameters }];
    const payload = await capture_payload(request);

    expect(payload["tools"]).toEqual([
      {
        type: "function",
        name: "probe",
        description: "探针工具",
        parameters,
        strict: false,
      },
    ]);
  });

  it("GPT Responses 的 OFF 档显式发送 reasoning.effort=none", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      model_id: "gpt-5.5",
      thinking: { level: "OFF" },
    });
    const payload = await capture_payload(request);

    expect(request.model.reasoning).toBe(true);
    expect(request.options).not.toHaveProperty("reasoningEffort");
    expect(payload).toHaveProperty("reasoning.effort", "none");
    expect(payload).not.toHaveProperty("reasoning.summary");
    expect(payload).not.toHaveProperty("include");
  });

  it("GPT Responses 的最高档启用 Pi reasoning 连续性", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      model_id: "gpt-5.5",
      thinking: { level: "MAX" },
    });
    const payload = await capture_payload(request);

    expect(request.model.reasoning).toBe(true);
    expect(request.options).toMatchObject({ reasoningEffort: "max" });
    expect(payload).toMatchObject({
      reasoning: { effort: "max", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    });
    expect(payload["input"]).toEqual([
      { role: "developer", content: "系统约束" },
      {
        role: "user",
        content: [{ type: "input_text", text: "こんにちは" }],
      },
    ]);
  });

  it("Kimi K3 的特高档在 Pi 与最终 payload 中统一降为 high", async () => {
    const request = resolve_request({
      api_format: "OpenAI",
      model_id: "kimi-k3",
      thinking: { level: "XHIGH" },
    });
    const payload = await capture_payload(request);

    expect(request.model).toMatchObject({ reasoning: true });
    expect(payload).toHaveProperty("reasoning_effort", "high");
  });

  it("Responses 未收录模型即使选择 HIGH 也不启用 reasoning", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      model_id: "custom-reasoning-model",
      thinking: { level: "HIGH" },
    });
    const payload = await capture_payload(request);

    expect(request.model.reasoning).toBe(false);
    expect(request.options).not.toHaveProperty("reasoningEffort");
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("include");
  });

  it("让 Pi 按 catalog 为 Anthropic legacy 模型构造 budget thinking", async () => {
    const request = resolve_request({
      api_format: "Anthropic",
      api_url: "https://anthropic.example/",
      model_id: "claude-sonnet-4-5",
      generation: {
        temperature_custom_enable: true,
        temperature: 0.4,
        top_p_custom_enable: true,
        top_p: 0.7,
      },
      thinking: { level: "HIGH" },
      threshold: { output_token_limit: 0 },
    });
    const payload = await capture_payload(request);

    expect(request.options).toMatchObject({
      cacheRetention: "none",
      interleavedThinking: false,
      maxRetries: 0,
      maxTokens: 8192,
      reasoning: "high",
    });
    expect(request.options).not.toHaveProperty("temperature");
    expect(payload).toMatchObject({
      model: "claude-sonnet-4-5",
      system: [{ type: "text", text: "系统约束" }],
      messages: [{ role: "user", content: "こんにちは" }],
      stream: true,
      max_tokens: 8192,
      thinking: { type: "enabled", budget_tokens: 7168, display: "summarized" },
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
  });

  it("让 Pi catalog 为带前后缀的 Anthropic 模型保留原始 ID并启用 adaptive", async () => {
    const request = resolve_request({
      api_format: "Anthropic",
      api_url: "https://anthropic-proxy.example/root",
      model_id: "vendor/claude-opus-4-8:fast",
      thinking: { level: "MAX" },
    });
    const payload = await capture_payload(request);

    expect(request.model).toMatchObject({
      id: "vendor/claude-opus-4-8:fast",
      baseUrl: "https://anthropic-proxy.example/root",
      reasoning: true,
      compat: { forceAdaptiveThinking: true, supportsTemperature: false },
    });
    expect(request.options).toMatchObject({ reasoning: "max" });
    expect(payload).toMatchObject({
      model: "vendor/claude-opus-4-8:fast",
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "max" },
    });
  });

  it("让 Pi 构造 Google contents，并在 extra_body 后强制内部取消信号", async () => {
    const request = resolve_request({
      api_format: "Google",
      api_url: "https://google.example",
      model_id: "gemini-2.5-flash",
      generation: {
        temperature_custom_enable: true,
        temperature: 0.2,
        top_p_custom_enable: true,
        top_p: 0.9,
      },
      thinking: { level: "LOW" },
      request: {
        extra_headers_custom_enable: false,
        extra_body_custom_enable: true,
        extra_body: { responseMimeType: "application/json", abortSignal: "bad" },
      },
    });
    const payload = await capture_payload(request);
    const config = payload["config"];
    if (!is_json_record(config)) throw new Error("Google 测试缺少 config");

    expect(request.model.baseUrl).toBe("https://google.example/v1beta");
    expect(payload["contents"]).toEqual([
      { role: "user", parts: [{ text: "系统约束" }] },
      { role: "user", parts: [{ text: "こんにちは" }] },
    ]);
    expect(config).toMatchObject({
      temperature: 0.2,
      maxOutputTokens: 4096,
      topP: 0.9,
      responseMimeType: "application/json",
      abortSignal: request.options.signal,
      thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
    });
    expect(config["safetySettings"]).toHaveLength(4);
  });

  it("让 Pi catalog 为带前后缀的 Gemini 保留原始 ID并应用向下降档", async () => {
    const request = resolve_request({
      api_format: "Google",
      api_url: "https://google-proxy.example/api",
      model_id: "vendor/models/gemini-3.6-flash:free",
      thinking: { level: "MAX" },
    });
    const payload = await capture_payload(request);
    const config = payload["config"];
    if (!is_json_record(config)) throw new Error("Google 测试缺少 config");

    expect(request.model).toMatchObject({
      id: "vendor/models/gemini-3.6-flash:free",
      baseUrl: "https://google-proxy.example/api/v1beta",
      reasoning: true,
    });
    expect(request.options).toMatchObject({ reasoning: "high" });
    expect(payload["model"]).toBe("vendor/models/gemini-3.6-flash:free");
    expect(config["thinkingConfig"]).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
  });
});

type ResolvedRequest = ReturnType<typeof resolve_one_shot_pi_request>;

/** 使用统一模型夹具生成可直接交给 Pi adapter 的 OneShot 请求。 */
function resolve_request(overrides: JsonRecord): ResolvedRequest {
  const snapshot = read_model_request_snapshot(create_model(overrides), TEST_USER_AGENT);
  return resolve_one_shot_pi_request(
    snapshot,
    [
      { role: "system", content: " 系统约束 " },
      { role: "user", content: " こんにちは " },
    ],
    new AbortController().signal,
  );
}

/** 在真实 adapter 的 onPayload 边界截获最终 payload，避免发起网络请求。 */
async function capture_payload(request: ResolvedRequest): Promise<Record<string, unknown>> {
  let captured: unknown;
  const production_on_payload = request.options.onPayload;
  const options: ProviderStreamOptions = {
    ...request.options,
    onPayload: async (payload: unknown, model: Model<string>) => {
      captured = (await production_on_payload?.(payload, model)) ?? payload;
      throw new Error("capture-payload");
    },
  };
  await request.stream(request.model, request.context, options).result();
  if (!is_json_record(captured)) throw new Error("未捕获 Pi payload");
  return captured;
}

/** 构造 policy 所需的最小模型配置，单项测试只覆盖关心字段。 */
function create_model(overrides: JsonRecord = {}): JsonRecord {
  return {
    api_format: "OpenAI",
    api_key: "key",
    api_url: "https://example.com/v1",
    generation: {},
    model_id: "gpt-5-mini",
    request: {
      extra_body_custom_enable: false,
      extra_headers_custom_enable: false,
    },
    thinking: { level: "OFF" },
    threshold: { output_token_limit: 4096 },
    ...overrides,
  };
}

function create_catalog_model(id: string): Model<"google-generative-ai"> {
  return {
    id,
    name: id,
    api: "google-generative-ai",
    provider: "google",
    baseUrl: "https://example.com/v1beta",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  };
}
