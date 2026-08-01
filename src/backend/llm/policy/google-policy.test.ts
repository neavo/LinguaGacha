import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_google_one_shot_request_overrides,
  apply_google_request_overrides,
  build_google_thinking_config,
  normalize_google_api_base_url,
} from "./google-policy";

describe("Google 请求规则", () => {
  it.each([
    ["", "https://generativelanguage.googleapis.com/v1beta"],
    ["https://proxy.example/google", "https://proxy.example/google/v1beta"],
    ["https://proxy.example/google/", "https://proxy.example/google/v1beta"],
    ["https://proxy.example/google/v1", "https://proxy.example/google/v1"],
    ["https://proxy.example/google/v1beta/", "https://proxy.example/google/v1beta"],
    ["https://proxy.example/google/v1alpha", "https://proxy.example/google/v1alpha"],
  ])("把 Google API 地址 %s 归一为 %s", (url, expected) => {
    expect(normalize_google_api_base_url(url)).toBe(expected);
  });

  it("OneShot 补齐生成、安全和思考字段，并让内部 signal 最终生效", () => {
    const signal = new AbortController().signal;
    const config = apply_google_one_shot_request_overrides(
      { temperature: 0.2, abortSignal: "pi-signal" },
      create_snapshot({
        generation: {
          top_p_custom_enable: true,
          top_p: 0.9,
          presence_penalty_custom_enable: true,
          presence_penalty: 0.1,
          frequency_penalty_custom_enable: true,
          frequency_penalty: 0.3,
        },
        extra_body: { responseMimeType: "application/json", abortSignal: "bad" },
        thinking_level: "LOW",
      }),
      signal,
    );

    expect(config).toMatchObject({
      temperature: 0.2,
      topP: 0.9,
      presencePenalty: 0.1,
      frequencyPenalty: 0.3,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 384, includeThoughts: true },
      abortSignal: signal,
    });
    expect(config["safetySettings"]).toHaveLength(4);
  });

  it("共享覆盖只替换 config thinking 并保留 Pi 结构字段", () => {
    const source = {
      systemInstruction: { parts: [{ text: "系统" }] },
      tools: [{ functionDeclarations: [{ name: "search" }] }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      thinkingConfig: { thinkingLevel: "HIGH" },
    };
    const config = apply_google_request_overrides(
      source,
      create_snapshot({
        thinking_level: "LOW",
        extra_body: { thinkingConfig: { thinkingBudget: 777 }, customFlag: true },
      }),
    );

    expect(config).toMatchObject({
      systemInstruction: source.systemInstruction,
      tools: source.tools,
      toolConfig: source.toolConfig,
      thinkingConfig: { thinkingBudget: 777 },
      customFlag: true,
    });
    expect(source).toHaveProperty("thinkingConfig.thinkingLevel", "HIGH");
  });

  it("保持 Gemini 2.5/3.x 的 thinking 能力映射", () => {
    expect(
      build_google_thinking_config({ model_id: "gemini-3.1-pro", thinking_level: "MEDIUM" }),
    ).toEqual({ thinkingLevel: "MEDIUM", includeThoughts: true });
    expect(
      build_google_thinking_config({ model_id: "gemini-3.5-flash", thinking_level: "OFF" }),
    ).toEqual({ thinkingLevel: "MINIMAL", includeThoughts: false });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-pro", thinking_level: "OFF" }),
    ).toEqual({ thinkingBudget: 128, includeThoughts: false });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-flash-lite", thinking_level: "LOW" }),
    ).toEqual({ thinkingBudget: 512, includeThoughts: true });
    expect(
      build_google_thinking_config({ model_id: "gemini-2.5-flash", thinking_level: "HIGH" }),
    ).toEqual({ thinkingBudget: 1024, includeThoughts: true });
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "google",
    api_format: "Google",
    api_keys: ["key"],
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    model_id: "gemini-2.5-flash",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
