import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { LLMClientPolicy } from "./llm-client-policy";
import { build_google_thinking_config } from "./policy/google-policy";

describe("LLMClientPolicy", () => {
  it("自定义 OpenAI-compatible endpoint 使用最终 payload 并写入 GPT-5 thinking 规则", async () => {
    const policy = new LLMClientPolicy(await create_app_root());

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
      max_tokens: 4096,
      model: "gpt-5-mini",
      reasoning_effort: "none",
      stream: true,
      temperature: 0.3,
      top_p: 0.8,
    });
  });

  it("Gemini 2.5 Flash OFF 使用 thinkingBudget 0 且不 include thoughts", async () => {
    const policy = new LLMClientPolicy(await create_app_root());

    const resolved = policy.resolve(
      create_body({
        api_format: "Google",
        model_id: "gemini-2.5-flash",
        thinking: { level: "OFF" },
        request: {
          extra_body_custom_enable: true,
          extra_body: { responseMimeType: "application/json" },
        },
      }),
    );

    expect(resolved.provider).toBe("google");
    expect(resolved.payload["config"]).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
    });
  });

  it("Mimo v2 系列 thinking 等级映射为 OpenAI-compatible thinking.type", async () => {
    const policy = new LLMClientPolicy(await create_app_root());

    const off_resolved = policy.resolve(
      create_body({
        api_format: "OpenAI",
        model_id: "mimo-v2-flash",
        thinking: { level: "OFF" },
      }),
    );
    const high_resolved = policy.resolve(
      create_body({
        api_format: "OpenAI",
        model_id: "mimo-v2.5-pro",
        thinking: { level: "HIGH" },
      }),
    );

    expect(off_resolved.payload["thinking"]).toEqual({ type: "disabled" });
    expect(high_resolved.payload["thinking"]).toEqual({ type: "enabled" });
  });

  it("Gemini thinking 等级按官方能力映射到预算和等级字段", () => {
    expect(
      build_google_thinking_config({ model_id: "gemini-3.1-pro", thinking_level: "OFF" }),
    ).toEqual({ thinkingLevel: "LOW", includeThoughts: false });
    expect(
      build_google_thinking_config({ model_id: "gemini-3.1-pro", thinking_level: "MEDIUM" }),
    ).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: true });
    expect(
      build_google_thinking_config({ model_id: "gemini-3-flash-preview", thinking_level: "OFF" }),
    ).toEqual({ thinkingLevel: "MINIMAL", includeThoughts: false });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-pro", thinking_level: "OFF" }),
    ).toEqual({ thinkingBudget: 128, includeThoughts: false });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-flash-lite", thinking_level: "LOW" }),
    ).toEqual({ thinkingBudget: 512, includeThoughts: true });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-flash", thinking_level: "MEDIUM" }),
    ).toEqual({ thinkingBudget: 768, includeThoughts: true });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-flash", thinking_level: "HIGH" }),
    ).toEqual({ thinkingBudget: 1024, includeThoughts: true });
  });

  it("Google SDK baseUrl 会移除末尾版本段且不影响其它 provider", () => {
    expect(LLMClientPolicy.normalize_api_url("", "Google")).toBe("");
    expect(
      LLMClientPolicy.normalize_api_url("https://generativelanguage.googleapis.com", "Google"),
    ).toBe("https://generativelanguage.googleapis.com");
    expect(
      LLMClientPolicy.normalize_api_url("https://generativelanguage.googleapis.com/v1", "Google"),
    ).toBe("https://generativelanguage.googleapis.com");
    expect(
      LLMClientPolicy.normalize_api_url(
        "https://generativelanguage.googleapis.com/v1beta/",
        "Google",
      ),
    ).toBe("https://generativelanguage.googleapis.com");
    expect(
      LLMClientPolicy.normalize_api_url(
        "https://generativelanguage.googleapis.com/v1alpha",
        "Google",
      ),
    ).toBe("https://generativelanguage.googleapis.com");
    expect(LLMClientPolicy.normalize_api_url("https://proxy.example/google/v1beta", "Google")).toBe(
      "https://proxy.example/google",
    );
    expect(LLMClientPolicy.normalize_api_url("https://api.example/v1", "OpenAI")).toBe(
      "https://api.example/v1",
    );
    expect(
      LLMClientPolicy.normalize_api_url("https://sakura.example/v1/chat/completions/", "SakuraLLM"),
    ).toBe("https://sakura.example/v1");
    expect(LLMClientPolicy.normalize_api_url("https://api.anthropic.com/", "Anthropic")).toBe(
      "https://api.anthropic.com",
    );
  });

  it("Claude thinking 开启时移除 temperature 和 top_p", async () => {
    const policy = new LLMClientPolicy(await create_app_root());

    const resolved = policy.resolve(
      create_body({
        api_format: "Anthropic",
        model_id: "claude-sonnet-4-5",
        thinking: { level: "HIGH" },
        generation: {
          temperature_custom_enable: true,
          temperature: 0.4,
          top_p_custom_enable: true,
          top_p: 0.7,
        },
      }),
    );

    expect(resolved.provider).toBe("anthropic");
    expect(resolved.payload["temperature"]).toBeUndefined();
    expect(resolved.payload["top_p"]).toBeUndefined();
    expect(resolved.payload["thinking"]).toEqual({ type: "enabled", budget_tokens: 2048 });
  });
});

/**
 * 构造 policy 测试请求体，模型差异只通过 overrides 表达。
 */
function create_body(model_overrides: Record<string, ApiJsonValue>) {
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

/**
 * 创建带固定 version.txt 的 appRoot，保证 User-Agent 断言稳定。
 */
async function create_app_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-policy-"));
  await writeFile(path.join(app_root, "version.txt"), "1.2.3", "utf-8");
  return app_root;
}
