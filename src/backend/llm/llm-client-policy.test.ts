import { describe, expect, it } from "vitest";

import type { JsonRecord } from "../../domain/json";
import { LLMClientPolicy } from "./llm-client-policy";

const TEST_USER_AGENT = "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)";

describe("LLMClientPolicy", () => {
  it("解析模型快照并交给 OpenAI-compatible policy", () => {
    const policy = new LLMClientPolicy(TEST_USER_AGENT);

    const resolved = policy.resolve(
      create_body({
        api_format: "OpenAI",
        api_key: "key-1\nkey-2",
        api_url: "https://example.com/v1/chat/completions",
        model_id: "gpt-5-mini",
        request: {
          extra_headers_custom_enable: true,
          extra_headers: { "X-Test": "yes" },
          extra_body_custom_enable: true,
          extra_body: { custom: true },
        },
        thinking: { level: "OFF" },
        generation: {
          temperature_custom_enable: true,
          temperature: 0.3,
          top_p_custom_enable: true,
          top_p: 0.8,
        },
      }),
    );

    expect(resolved.provider).toBe("openai-compatible");
    expect(resolved.base_url).toBe("https://example.com/v1");
    expect(resolved.api_keys).toEqual(["key-1", "key-2"]);
    expect(resolved.headers).toMatchObject({
      "User-Agent": "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)",
      "X-Test": "yes",
    });
    expect(resolved.payload).toMatchObject({
      custom: true,
      model: "gpt-5-mini",
      temperature: 0.3,
    });
    expect(resolved.timeout_ms).toBe(120_000);
  });

  it.each([
    ["Google", "google"],
    ["Anthropic", "anthropic"],
    ["SakuraLLM", "sakura"],
  ] as const)("把 %s api_format 分发到 %s provider", (api_format, provider) => {
    const policy = new LLMClientPolicy(TEST_USER_AGENT);

    expect(policy.resolve(create_body({ api_format })).provider).toBe(provider);
  });

  it("按 provider 分发 URL 归一规则", () => {
    expect(
      LLMClientPolicy.normalize_api_url("https://generativelanguage.googleapis.com/v1", "Google"),
    ).toBe("https://generativelanguage.googleapis.com");
    expect(
      LLMClientPolicy.normalize_api_url("https://api.example/v1/chat/completions", "OpenAI"),
    ).toBe("https://api.example/v1");
    expect(
      LLMClientPolicy.normalize_api_url("https://sakura.example/v1/chat/completions/", "SakuraLLM"),
    ).toBe("https://sakura.example/v1");
    expect(LLMClientPolicy.normalize_api_url("https://api.anthropic.com/", "Anthropic")).toBe(
      "https://api.anthropic.com",
    );
  });

  it("多行 API key 归一后模型测试使用第一枚 key", () => {
    expect(LLMClientPolicy.collect_api_keys(" key-1 \n\nkey-2\r\n ")).toEqual(["key-1", "key-2"]);
    expect(LLMClientPolicy.collect_api_keys("   ")).toEqual(["no_key_required"]);
    expect(LLMClientPolicy.get_primary_api_key(" key-1 \nkey-2")).toBe("key-1");
  });

  it("请求超时缺字段时使用 settings 领域默认值", () => {
    const policy = new LLMClientPolicy(TEST_USER_AGENT);

    const resolved = policy.resolve({
      ...create_body({}),
      config_snapshot: {},
    });

    expect(resolved.timeout_ms).toBe(120_000);
  });

  it("拒绝不符合 Pi provider 契约的 payload", () => {
    const policy = new LLMClientPolicy(TEST_USER_AGENT);
    const openai = policy.read_model_snapshot(create_body({}).model);
    const google = policy.read_model_snapshot(create_body({ api_format: "Google" }).model);

    expect(() => policy.apply_request_overrides(openai, null)).toThrow(
      "runtime.internal_invariant",
    );
    expect(() => policy.apply_request_overrides(google, { contents: [] })).toThrow(
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
    const policy = new LLMClientPolicy(TEST_USER_AGENT);
    const snapshot = policy.read_model_snapshot(create_body({ api_format, model_id }).model);

    expect(policy.supports_thinking(snapshot)).toBe(expected);
  });
});

/**
 * 构造 policy 测试请求体，模型差异只通过 overrides 表达。
 */
function create_body(model_overrides: JsonRecord) {
  return {
    run_id: "run-1",
    work_unit_id: "unit-1",
    model: {
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
      ...model_overrides,
    },
    config_snapshot: { request_timeout: 120 },
    messages: [
      { role: "system", content: "系统" },
      { role: "user", content: '{"0":"こんにちは"}' },
    ],
  };
}
