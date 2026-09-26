import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../../domain/json";
import {
  collect_api_keys,
  get_primary_api_key,
  normalize_pi_api_url,
  read_model_request_snapshot,
  read_request_timeout_ms,
  resolve_one_shot_generation_options,
  build_request_headers,
} from "./llm-request";

const TEST_USER_AGENT = "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)";
const TEST_REQUEST_IDENTITY = { user_agent: TEST_USER_AGENT, session_id: "test-session" };

describe("LLM 请求策略", () => {
  it("把模型配置收窄为共享请求快照", () => {
    const snapshot = read_model_request_snapshot(
      create_model({
        api_format: "OpenAI",
        api_key: "key-1\nkey-2",
        api_url: "https://example.com/v1/chat/completions",
        request: {
          extra_headers_custom_enable: true,
          extra_headers: { "X-Test": "yes" },
          extra_body_custom_enable: true,
          extra_body: { custom: true },
        },
      }),
      TEST_REQUEST_IDENTITY,
    );

    expect(snapshot).toMatchObject({
      api_format: "OpenAI",
      api_keys: ["key-1", "key-2"],
      base_url: "https://example.com/v1",
      model_id: "gpt-5-mini",
      headers: { "User-Agent": TEST_USER_AGENT, "x-test": "yes" },
      extra_body: { custom: true },
      output_token_limit: 4096,
      thinking_level: "OFF",
    });
    expect(snapshot).not.toHaveProperty("provider");
  });

  it("按 Pi adapter 契约归一请求 URL", () => {
    expect(normalize_pi_api_url("https://google.example", "Google")).toBe(
      "https://google.example/v1beta",
    );
    expect(normalize_pi_api_url("https://api.example/v1/chat/completions", "OpenAI")).toBe(
      "https://api.example/v1",
    );
    expect(normalize_pi_api_url("https://api.example/v1/responses/", "OpenAIResponses")).toBe(
      "https://api.example/v1",
    );
    expect(normalize_pi_api_url("https://sakura.example/v1/chat/completions/", "SakuraLLM")).toBe(
      "https://sakura.example/v1",
    );
    expect(normalize_pi_api_url("https://api.anthropic.com/", "Anthropic")).toBe(
      "https://api.anthropic.com",
    );
  });

  it("关闭的扩展配置不进入请求策略", () => {
    const snapshot = read_model_request_snapshot(
      create_model({
        api_url: "https://opencode.ai/zen/go/v1",
        request: {
          extra_headers_custom_enable: false,
          extra_headers: { "x-opencode-session": "manual-session" },
          extra_body_custom_enable: false,
          extra_body: { custom: true },
        },
      }),
      TEST_REQUEST_IDENTITY,
    );
    expect(snapshot.headers).toEqual({
      "User-Agent": TEST_USER_AGENT,
      "x-opencode-session": "test-session",
    });
    expect(snapshot.extra_body).toEqual({});
  });

  it("归一多行 API key 并提供模型列表使用的主 key", () => {
    expect(collect_api_keys(" key-1 \n\nkey-2\r\n ")).toEqual(["key-1", "key-2"]);
    expect(collect_api_keys("   ")).toEqual(["no_key_required"]);
    expect(get_primary_api_key(" key-1 \nkey-2")).toBe("key-1");
  });

  it("把请求时限换算为毫秒并限制最短时限", () => {
    expect(read_request_timeout_ms({ request_timeout: 1.9 })).toBe(1_900);
    expect(read_request_timeout_ms({ request_timeout: 0 })).toBe(1_000);
  });

  it("OneShot 传递自定义温度并区分自动与显式输出上限", () => {
    const openai = read_model_request_snapshot(
      create_model({
        generation: { temperature_custom_enable: true, temperature: 0.3 },
        threshold: { output_token_limit: 0 },
      }),
      TEST_REQUEST_IDENTITY,
    );
    const anthropic_explicit = read_model_request_snapshot(
      create_model({ api_format: "Anthropic" }),
      TEST_REQUEST_IDENTITY,
    );

    expect(resolve_one_shot_generation_options(openai)).toEqual({ temperature: 0.3 });
    expect(resolve_one_shot_generation_options(anthropic_explicit)).toEqual({ maxTokens: 4096 });
  });

  it.each([
    ["https://opencode.ai/zen/v1", "test-session"],
    ["https://OPENCODE.AI/zen/go/v1/chat/completions", "test-session"],
    ["https://opencode.ai.example/v1", null],
    ["https://proxy.opencode.ai/v1", null],
    ["", null],
  ])("按精确主机名设置产品会话头：%s", (url, expected) => {
    expect(
      new Headers(build_request_headers(url, TEST_REQUEST_IDENTITY, {})).get("x-opencode-session"),
    ).toBe(expected);
  });

  it("用户请求头按大小写不敏感覆盖产品身份", () => {
    expect(
      build_request_headers("https://opencode.ai/zen/v1", TEST_REQUEST_IDENTITY, {
        "X-OpenCode-Session": "manual-session",
        "user-agent": "Custom/1",
      }),
    ).toEqual({ "User-Agent": "Custom/1", "x-opencode-session": "manual-session" });
  });

  it.each(["v1", "v1beta", "v1alpha"])("Google 保留显式 API 版本 %s", (version) => {
    expect(normalize_pi_api_url(`https://proxy.example/google/${version}/`, "Google")).toBe(
      `https://proxy.example/google/${version}`,
    );
  });

  it.each([true, false])("OpenAI 按启用状态 %s 通过正式选项传递 top_p", (enabled) => {
    const snapshot = read_model_request_snapshot(
      create_model({ generation: { top_p_custom_enable: enabled, top_p: 0.8 } }),
      TEST_REQUEST_IDENTITY,
    );
    expect(resolve_one_shot_generation_options(snapshot).samplingParams).toEqual(
      enabled ? { top_p: 0.8 } : undefined,
    );
  });
  it.each(["DEFAULT", "OFF", "HIGH"] as const)("Anthropic %s 根据显式思考意图处理温度", (level) => {
    const snapshot = read_model_request_snapshot(
      create_model({
        api_format: "Anthropic",
        thinking: { level },
        generation: { temperature_custom_enable: true, temperature: 0.3 },
      }),
      TEST_REQUEST_IDENTITY,
    );
    const options = resolve_one_shot_generation_options(snapshot);
    if (level === "HIGH") expect(options).not.toHaveProperty("temperature");
    else expect(options.temperature).toBe(0.3);
  });
});

/** 模型配置夹具保留原始 JSON 形状，由生产入口收窄。 */
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
