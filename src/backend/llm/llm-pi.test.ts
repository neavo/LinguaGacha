import { Type, type Model, type ProviderStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { is_json_record, type JsonRecord } from "../../domain/json";
import { read_model_request_snapshot } from "./llm-client-policy";
import { resolve_one_shot_pi_request, resolve_pi_model } from "./llm-pi";

const TEST_USER_AGENT = "LinguaGacha/Test";

describe("pi-ai 请求适配", () => {
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
      reasoning: false,
      input: ["text"],
    });

    expect(resolved.model).toMatchObject({ provider, api, name: "Test" });
  });

  it.each(["OpenAI", "OpenAIResponses", "SakuraLLM", "Anthropic", "Google"] as const)(
    "%s 在协议转换前拒绝空业务提示词",
    (api_format) => {
      const snapshot = read_model_request_snapshot(create_model({ api_format }), TEST_USER_AGENT);

      expect(() =>
        resolve_one_shot_pi_request(
          snapshot,
          [{ role: "user", content: "   " }],
          new AbortController().signal,
        ),
      ).toThrow("request.validation_failed");
    },
  );

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
      reasoning: false,
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

  it("GPT-5.6 Responses 的 OFF 档显式发送 reasoning.effort=none", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      model_id: "gpt-5.6-luna",
      thinking: { level: "OFF" },
    });
    const payload = await capture_payload(request);

    expect(request.model.reasoning).toBe(true);
    expect(request.options).not.toHaveProperty("reasoningEffort");
    expect(payload).toHaveProperty("reasoning.effort", "none");
    expect(payload).not.toHaveProperty("reasoning.summary");
    expect(payload).not.toHaveProperty("include");
  });

  it("GPT-5.6 Responses 的非 OFF 档启用 Pi reasoning 连续性", async () => {
    const request = resolve_request({
      api_format: "OpenAIResponses",
      model_id: "gpt-5.6-luna",
      thinking: { level: "HIGH" },
    });
    const payload = await capture_payload(request);

    expect(request.model.reasoning).toBe(true);
    expect(request.options).toMatchObject({ reasoningEffort: "high" });
    expect(payload).toMatchObject({
      reasoning: { effort: "high", summary: "auto" },
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

  it("让 Pi 构造 Anthropic system/messages，并保持 thinking 采样互斥", async () => {
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
    });
    expect(request.options).not.toHaveProperty("temperature");
    expect(payload).toMatchObject({
      model: "claude-sonnet-4-5",
      system: "系统约束",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: true,
      max_tokens: 8192,
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
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
    });
    expect(config).not.toHaveProperty("thinkingConfig");
    expect(config["safetySettings"]).toHaveLength(4);
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
