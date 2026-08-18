import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_google_one_shot_request_overrides,
  apply_google_request_overrides,
  normalize_google_api_base_url,
} from "./google-policy";

describe("Google 请求规则", () => {
  it.each([
    ["https://proxy.example/google", "https://proxy.example/google/v1beta"],
    ["https://proxy.example/google/", "https://proxy.example/google/v1beta"],
    ["https://proxy.example/google/v1", "https://proxy.example/google/v1"],
    ["https://proxy.example/google/v1beta/", "https://proxy.example/google/v1beta"],
    ["https://proxy.example/google/v1alpha", "https://proxy.example/google/v1alpha"],
  ])("把 Google API 地址 %s 归一为 %s", (url, expected) => {
    expect(normalize_google_api_base_url(url)).toBe(expected);
  });

  it("OneShot 补齐生成与安全字段，并让内部 signal 最终生效", () => {
    const signal = new AbortController().signal;
    const config = apply_google_one_shot_request_overrides(
      { temperature: 0.2, abortSignal: "pi-signal" },
      create_snapshot({
        generation: {
          top_p_custom_enable: true,
          top_p: 0.9,
        },
        extra_body: { responseMimeType: "application/json", abortSignal: "bad" },
        model_id: "custom-model",
        thinking_level: "LOW",
      }),
      signal,
    );

    expect(config).toMatchObject({
      temperature: 0.2,
      topP: 0.9,
      responseMimeType: "application/json",
      abortSignal: signal,
    });
    const safety_settings = config["safetySettings"];
    expect(Array.isArray(safety_settings)).toBe(true);
    expect(
      Array.isArray(safety_settings) &&
        safety_settings.length > 0 &&
        safety_settings.every((setting) => setting["threshold"] === "BLOCK_NONE"),
    ).toBe(true);
  });

  it("共享覆盖保留 Pi thinking 并合并其它扩展字段", () => {
    const source = {
      systemInstruction: { parts: [{ text: "系统" }] },
      tools: [{ functionDeclarations: [{ name: "search" }] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      thinkingConfig: { thinkingLevel: "HIGH" },
    };
    const config = apply_google_request_overrides(
      source,
      create_snapshot({
        model_id: "custom-model",
        thinking_level: "LOW",
        extra_body: { thinkingConfig: { thinkingBudget: 777 }, customFlag: true },
      }),
    );

    expect(config).toMatchObject({
      systemInstruction: source.systemInstruction,
      tools: source.tools,
      toolConfig: source.toolConfig,
      thinkingConfig: { thinkingLevel: "HIGH" },
      customFlag: true,
    });
    expect(source).toHaveProperty("thinkingConfig.thinkingLevel", "HIGH");
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    api_format: "Google",
    api_keys: ["key"],
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    model_id: "gemini-3.1-pro",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
