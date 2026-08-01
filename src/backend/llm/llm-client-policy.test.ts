import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../../domain/json";
import {
  apply_agent_request_overrides,
  collect_api_keys,
  get_primary_api_key,
  normalize_pi_api_url,
  read_model_request_snapshot,
  read_request_timeout_ms,
  resolve_one_shot_generation_options,
  supports_thinking,
} from "./llm-client-policy";

const TEST_USER_AGENT = "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)";

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
      TEST_USER_AGENT,
    );

    expect(snapshot).toMatchObject({
      provider: "openai-compatible",
      api_format: "OpenAI",
      api_keys: ["key-1", "key-2"],
      base_url: "https://example.com/v1",
      model_id: "gpt-5-mini",
      headers: { "User-Agent": TEST_USER_AGENT, "X-Test": "yes" },
      extra_body: { custom: true },
      output_token_limit: 4096,
      thinking_level: "OFF",
    });
  });

  it.each([
    ["Google", "google"],
    ["Anthropic", "anthropic"],
    ["SakuraLLM", "sakura"],
  ] as const)("把 %s api_format 分发到 %s provider", (api_format, provider) => {
    expect(
      read_model_request_snapshot(create_model({ api_format }), TEST_USER_AGENT).provider,
    ).toBe(provider);
  });

  it("按 Pi adapter 契约归一请求 URL", () => {
    expect(normalize_pi_api_url("https://google.example", "Google")).toBe(
      "https://google.example/v1beta",
    );
    expect(normalize_pi_api_url("https://google.example/v1alpha/", "Google")).toBe(
      "https://google.example/v1alpha",
    );
    expect(normalize_pi_api_url("", "Google")).toBe("");
    expect(normalize_pi_api_url("https://api.example/v1/chat/completions", "OpenAI")).toBe(
      "https://api.example/v1",
    );
    expect(normalize_pi_api_url("https://sakura.example/v1/chat/completions/", "SakuraLLM")).toBe(
      "https://sakura.example/v1",
    );
    expect(normalize_pi_api_url("https://api.anthropic.com/", "Anthropic")).toBe(
      "https://api.anthropic.com",
    );
  });

  it("归一多行 API key 并提供模型列表使用的主 key", () => {
    expect(collect_api_keys(" key-1 \n\nkey-2\r\n ")).toEqual(["key-1", "key-2"]);
    expect(collect_api_keys("   ")).toEqual(["no_key_required"]);
    expect(get_primary_api_key(" key-1 \nkey-2")).toBe("key-1");
  });

  it("保持请求超时换算、默认值和最小一秒语义", () => {
    expect(read_request_timeout_ms({})).toBe(120_000);
    expect(read_request_timeout_ms({ request_timeout: 1.9 })).toBe(1_900);
    expect(read_request_timeout_ms({ request_timeout: 0 })).toBe(1_000);
  });

  it("只为 OneShot 解析通用温度和输出上限", () => {
    const openai = read_model_request_snapshot(
      create_model({
        generation: { temperature_custom_enable: true, temperature: 0.3 },
        threshold: { output_token_limit: 0 },
      }),
      TEST_USER_AGENT,
    );
    const anthropic = read_model_request_snapshot(
      create_model({ api_format: "Anthropic", thinking: { level: "HIGH" } }),
      TEST_USER_AGENT,
    );

    expect(resolve_one_shot_generation_options(openai)).toEqual({ temperature: 0.3 });
    expect(resolve_one_shot_generation_options(anthropic)).toEqual({ maxTokens: 4096 });
  });

  it("拒绝不符合 Pi provider 契约的 Agent payload", () => {
    const openai = read_model_request_snapshot(create_model(), TEST_USER_AGENT);
    const google = read_model_request_snapshot(
      create_model({ api_format: "Google" }),
      TEST_USER_AGENT,
    );

    expect(() => apply_agent_request_overrides(openai, null)).toThrow("runtime.internal_invariant");
    expect(() => apply_agent_request_overrides(google, { contents: [] })).toThrow(
      "runtime.internal_invariant",
    );
  });

  it.each([
    ["OpenAI", "kimi-k3", true],
    ["OpenAI", "unknown-model", false],
    ["Anthropic", "claude-sonnet-4-5", true],
    ["Google", "gemini-2.5-flash", true],
    ["SakuraLLM", "sakura-v1", false],
  ] as const)("从 %s/%s 的模型族规则判断思考能力", (api_format, model_id, expected) => {
    const snapshot = read_model_request_snapshot(
      create_model({ api_format, model_id }),
      TEST_USER_AGENT,
    );
    expect(supports_thinking(snapshot)).toBe(expected);
  });
});

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
