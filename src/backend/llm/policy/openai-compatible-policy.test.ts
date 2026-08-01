import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_openai_one_shot_request_overrides,
  apply_openai_request_overrides,
  apply_sakura_one_shot_request_overrides,
  build_openai_thinking_payload,
  normalize_openai_compatible_base_url,
} from "./openai-compatible-policy";

describe("OpenAI-compatible 请求规则", () => {
  it("base URL 去掉 chat completions 路径并保留接口根", () => {
    expect(
      normalize_openai_compatible_base_url(" https://api.example.com/v1/chat/completions/ "),
    ).toBe("https://api.example.com/v1");
  });

  it("OneShot 补齐生成字段，并让 extra_body 保持最终优先级", () => {
    const payload = apply_openai_one_shot_request_overrides(
      { model: "gpt-5-mini", max_tokens: 4096, reasoning_effort: "medium" },
      create_snapshot({
        generation: {
          top_p_custom_enable: true,
          top_p: 0.9,
          presence_penalty_custom_enable: true,
          presence_penalty: 0.1,
          frequency_penalty_custom_enable: true,
          frequency_penalty: 0.3,
        },
        extra_body: { max_tokens: 123, reasoning_effort: "high", custom_flag: true },
      }),
    );

    expect(payload).toMatchObject({
      model: "gpt-5-mini",
      max_tokens: 123,
      reasoning_effort: "high",
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.3,
      custom_flag: true,
    });
  });

  it("Sakura 只复用 OpenAI 生成字段，不注入模型族 thinking", () => {
    const payload = apply_sakura_one_shot_request_overrides(
      { messages: [] },
      create_snapshot({
        provider: "sakura",
        api_format: "SakuraLLM",
        model_id: "gpt-5-mini",
        generation: { top_p_custom_enable: true, top_p: 0.8 },
        extra_body: { custom_flag: true },
      }),
    );

    expect(payload).toEqual({ messages: [], top_p: 0.8, custom_flag: true });
  });

  it("共享覆盖清除 Pi 思考字段且不修改输入", () => {
    const source = {
      messages: [{ role: "user", content: "こんにちは" }],
      reasoning_effort: "medium",
      reasoning: { effort: "medium" },
      thinking: { type: "enabled" },
      enable_thinking: true,
      chat_template_kwargs: { enable_thinking: true },
    };
    const payload = apply_openai_request_overrides(
      source,
      create_snapshot({
        model_id: "kimi-k3",
        thinking_level: "MEDIUM",
        extra_body: { reasoning_effort: "high", custom_flag: true },
      }),
    );

    expect(payload).toMatchObject({
      messages: source.messages,
      reasoning_effort: "high",
      custom_flag: true,
    });
    expect(payload).not.toHaveProperty("reasoning");
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("enable_thinking");
    expect(payload).not.toHaveProperty("chat_template_kwargs");
    expect(source).toHaveProperty("reasoning_effort", "medium");
  });

  it.each([
    ["OFF", "low"],
    ["LOW", "low"],
    ["MEDIUM", "low"],
    ["HIGH", "high"],
  ] as const)("Kimi K3 将 %s 映射到 reasoning_effort=%s", (level, effort) => {
    expect(build_openai_thinking_payload("kimi-k3", level)).toEqual({
      reasoning_effort: effort,
    });
  });

  it.each([
    ["OFF", { thinking: { type: "disabled" } }, { thinking: { type: "disabled" } }],
    [
      "LOW",
      { thinking: { type: "enabled" }, reasoning_effort: "low" },
      { thinking: { type: "enabled" } },
    ],
    [
      "MEDIUM",
      { thinking: { type: "enabled" }, reasoning_effort: "low" },
      { thinking: { type: "enabled" } },
    ],
    [
      "HIGH",
      { thinking: { type: "enabled" }, reasoning_effort: "high" },
      { thinking: { type: "enabled" } },
    ],
  ] as const)("DeepSeek V4 Flash/Pro 保持 %s 挡映射", (level, flash, pro) => {
    expect(build_openai_thinking_payload("deepseek-v4-flash", level)).toEqual(flash);
    expect(build_openai_thinking_payload("deepseek-v4-pro", level)).toEqual(pro);
  });

  it("保持其余已支持模型族的简单匹配", () => {
    expect(build_openai_thinking_payload("gpt-4.1-mini", "OFF")).toEqual({
      reasoning_effort: "none",
    });
    expect(build_openai_thinking_payload("qwen2.5-plus", "OFF")).toEqual({
      enable_thinking: false,
    });
    expect(build_openai_thinking_payload("doubao-seed-1-5", "OFF")).toEqual({
      reasoning_effort: "minimal",
    });
    expect(build_openai_thinking_payload("mimo-v1-flash", "OFF")).toEqual({
      thinking: { type: "disabled" },
    });
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "openai-compatible",
    api_format: "OpenAI",
    api_keys: ["key"],
    base_url: "https://api.example.com/v1",
    model_id: "gpt-5-mini",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
