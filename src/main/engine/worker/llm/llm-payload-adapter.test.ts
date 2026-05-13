import { describe, expect, it } from "vitest";

import type { LinguaGachaModelSnapshot } from "./llm-model-adapter";
import {
  build_pi_ai_provider_options,
  patch_linguagacha_payload,
} from "./llm-payload-adapter";

describe("llm payload adapter", () => {
  it("为 GPT-5 OFF 注入 none reasoning_effort 并保留 generation 字段", () => {
    const snapshot = create_snapshot({
      api_format: "OpenAI",
      model_id: "gpt-5-mini",
      thinking_level: "OFF",
      generation: {
        temperature_custom_enable: true,
        temperature: 0.3,
        top_p_custom_enable: true,
        top_p: 0.8,
        presence_penalty_custom_enable: true,
        presence_penalty: 0.1,
        frequency_penalty_custom_enable: true,
        frequency_penalty: 0.2,
      },
    });
    const payload: Record<string, unknown> = {};

    const options = build_pi_ai_provider_options(snapshot);
    const patched = patch_linguagacha_payload(payload, snapshot) as Record<string, unknown>;

    expect(options["temperature"]).toBe(0.3);
    expect(patched).toMatchObject({
      top_p: 0.8,
      presence_penalty: 0.1,
      frequency_penalty: 0.2,
      reasoning_effort: "none",
    });
    expect(patched["extra_body"]).toBeUndefined();
  });

  it("为 Qwen3.5 与 DeepSeek 系模型注入各自兼容 thinking 结构", () => {
    const qwen_payload: Record<string, unknown> = {};
    const deepseek_payload: Record<string, unknown> = {};

    const qwen_patched = patch_linguagacha_payload(
      qwen_payload,
      create_snapshot({ model_id: "qwen3.5-coder", thinking_level: "HIGH" }),
    ) as Record<string, unknown>;
    const deepseek_patched = patch_linguagacha_payload(
      deepseek_payload,
      create_snapshot({ model_id: "deepseek-chat", thinking_level: "OFF" }),
    ) as Record<string, unknown>;

    expect(qwen_patched["enable_thinking"]).toBe(true);
    expect(deepseek_patched["thinking"]).toEqual({ type: "disabled" });
    expect(qwen_patched["extra_body"]).toBeUndefined();
  });

  it("为 Gemini 2.5 Flash 注入 safetySettings 与 thinkingConfig", () => {
    const snapshot = create_snapshot({
      api_format: "Google",
      model_id: "gemini-2.5-flash",
      thinking_level: "LOW",
      extra_body: { responseMimeType: "application/json" },
    });
    const payload: Record<string, unknown> = {};

    const options = build_pi_ai_provider_options(snapshot);
    const patched = patch_linguagacha_payload(payload, snapshot) as Record<string, unknown>;

    expect(options["thinking"]).toEqual({ enabled: true, budgetTokens: 384 });
    expect(patched["config"]).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 384, includeThoughts: true },
    });
    expect((patched["config"] as Record<string, unknown>)["safetySettings"]).toHaveLength(4);
  });

  it("为 Claude thinking 请求移除 temperature/top_p 并设置预算", () => {
    const snapshot = create_snapshot({
      api_format: "Anthropic",
      model_id: "claude-sonnet-4-5",
      thinking_level: "HIGH",
      generation: {
        temperature_custom_enable: true,
        temperature: 0.4,
        top_p_custom_enable: true,
        top_p: 0.7,
      },
      extra_body: { metadata: { trace: "unit" } },
    });
    const payload: Record<string, unknown> = {
      temperature: 0.4,
      extra_body: { service_tier: "auto" },
    };

    const options = build_pi_ai_provider_options(snapshot);
    const patched = patch_linguagacha_payload(payload, snapshot) as Record<string, unknown>;

    expect(options).toMatchObject({
      thinkingEnabled: true,
      thinkingBudgetTokens: 1024,
      thinkingDisplay: "summarized",
    });
    expect(patched["temperature"]).toBeUndefined();
    expect(patched["top_p"]).toBeUndefined();
    expect(patched["thinking"]).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(patched["service_tier"]).toBe("auto");
    expect(patched["metadata"]).toEqual({ trace: "unit" });
    expect(patched["extra_body"]).toBeUndefined();
  });
});

/**
 * 构造策略测试所需的最小模型快照，让每个断言只覆盖一个供应商差异
 */
function create_snapshot(
  overrides: Partial<LinguaGachaModelSnapshot> = {},
): LinguaGachaModelSnapshot {
  return {
    api_format: "OpenAI",
    api_keys: ["key"],
    api_url: "https://example.com/v1",
    extra_body: {},
    extra_headers: {},
    generation: {},
    model_id: "gpt-5-mini",
    output_token_limit: 4096,
    pi_model: {
      id: "model",
      name: "model",
      api: "openai-completions",
      provider: "openai",
      input: ["text"],
      contextWindow: 8192,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    thinking_level: "OFF",
    ...overrides,
  } as LinguaGachaModelSnapshot;
}
