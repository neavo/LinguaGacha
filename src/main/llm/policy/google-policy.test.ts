import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  build_google_payload,
  build_google_thinking_config,
  normalize_google_sdk_base_url,
} from "./google-policy";

describe("google-policy", () => {
  it("Google SDK baseUrl 去掉末尾版本段并保留代理根路径", () => {
    expect(normalize_google_sdk_base_url("https://generativelanguage.googleapis.com/v1beta/")).toBe(
      "https://generativelanguage.googleapis.com",
    );
    expect(normalize_google_sdk_base_url("https://proxy.example/google/v1alpha")).toBe(
      "https://proxy.example/google",
    );
  });

  it("构造 Gemini payload 时合并 system 文本并写入安全阈值和生成参数", () => {
    const payload = build_google_payload(
      create_snapshot({
        generation: {
          temperature_custom_enable: true,
          temperature: 0.2,
          top_p_custom_enable: true,
          top_p: 0.9,
          presence_penalty_custom_enable: true,
          presence_penalty: 0.1,
          frequency_penalty_custom_enable: true,
          frequency_penalty: 0.3,
        },
        extra_body: { responseMimeType: "application/json" },
        thinking_level: "LOW",
      }),
      [
        { role: "system", content: " 系统约束 " },
        { role: "system", content: " 输出 JSON " },
        { role: "user", content: " こんにちは " },
        { role: "assistant", content: " 你好 " },
      ],
    );

    expect(payload).toMatchObject({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: "系统约束\n\n输出 JSON" }] },
        { role: "user", parts: [{ text: "こんにちは" }] },
        { role: "model", parts: [{ text: "你好" }] },
      ],
      config: {
        temperature: 0.2,
        topP: 0.9,
        presencePenalty: 0.1,
        frequencyPenalty: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 384, includeThoughts: true },
      },
    });
    expect((payload["config"] as Record<string, unknown>)["safetySettings"]).toEqual([
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ]);
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

  it("空 Gemini contents 在协议边界直接阻断", () => {
    expect(() =>
      build_google_payload(create_snapshot(), [{ role: "user", content: "   " }]),
    ).toThrow("LLM 请求 messages 为空。");
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "google",
    api_format: "Google",
    api_keys: ["key"],
    base_url: "https://generativelanguage.googleapis.com",
    model_id: "gemini-2.5-flash",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
