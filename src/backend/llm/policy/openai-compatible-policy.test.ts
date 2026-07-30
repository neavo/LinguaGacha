import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_openai_request_overrides,
  build_openai_compatible_payload,
  normalize_chat_messages,
  normalize_openai_compatible_sdk_base_url,
} from "./openai-compatible-policy";

describe("openai-compatible-policy", () => {
  it("OpenAI-compatible baseUrl 去掉 chat completions 路径并保留接口根路径", () => {
    expect(
      normalize_openai_compatible_sdk_base_url(" https://api.example.com/v1/chat/completions/ "),
    ).toBe("https://api.example.com/v1");
  });

  it("构造 chat payload 时裁剪空白消息并写入启用的生成参数", () => {
    const payload = build_openai_compatible_payload(
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
      }),
      [
        { role: "system", content: " 系统约束 " },
        { role: "user", content: " こんにちは " },
        { role: "assistant", content: "   " },
      ],
    );

    expect(payload).toMatchObject({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: "系统约束" },
        { role: "user", content: "こんにちは" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
      reasoning_effort: "none",
      temperature: 0.2,
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.3,
    });
  });

  it("自定义 extra_body 最后合并并允许覆盖自动 token 策略", () => {
    const payload = build_openai_compatible_payload(
      create_snapshot({
        extra_body: { max_tokens: 123, custom_flag: true },
        output_token_limit: 0,
        thinking_level: "HIGH",
      }),
      [{ role: "user", content: "こんにちは" }],
    );

    expect(payload).toMatchObject({
      max_tokens: 123,
      custom_flag: true,
      reasoning_effort: "high",
    });
  });

  it("Qwen 3.x 模型写入 enable_thinking", () => {
    const payload = build_openai_compatible_payload(
      create_snapshot({
        model_id: "qwen3.7-plus",
        thinking_level: "HIGH",
      }),
      [{ role: "user", content: "こんにちは" }],
    );

    expect(payload).toMatchObject({
      enable_thinking: true,
    });
  });

  it("豆包 Seed 2.x 模型写入 reasoning_effort", () => {
    const payload = build_openai_compatible_payload(
      create_snapshot({
        model_id: "doubao-seed-2-1-lite-260428",
      }),
      [{ role: "user", content: "こんにちは" }],
    );

    expect(payload).toMatchObject({
      reasoning_effort: "minimal",
    });
  });

  it.each([
    ["OFF", "low"],
    ["LOW", "low"],
    ["MEDIUM", "low"],
    ["HIGH", "high"],
  ] as const)("Kimi K3 将 %s 挡映射到 reasoning_effort=%s", (thinking_level, effort) => {
    const payload = build_openai_compatible_payload(
      create_snapshot({ model_id: "kimi-k3", thinking_level }),
      [{ role: "user", content: "こんにちは" }],
    );

    expect(payload).toMatchObject({ reasoning_effort: effort });
    expect(payload).not.toHaveProperty("thinking");
  });

  it("共享覆盖规则清除 Pi 思考字段并允许 extra_body 最终覆盖", () => {
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
    ["OFF", "disabled"],
    ["HIGH", "enabled"],
  ] as const)("Kimi K2.6 保持 %s 挡的 thinking.type=%s", (thinking_level, type) => {
    const payload = build_openai_compatible_payload(
      create_snapshot({ model_id: "kimi-k2.6", thinking_level }),
      [{ role: "user", content: "こんにちは" }],
    );

    expect(payload).toMatchObject({ thinking: { type } });
    expect(payload).not.toHaveProperty("reasoning_effort");
  });

  it("简单族匹配覆盖同名相邻模型", () => {
    expect(
      build_openai_compatible_payload(create_snapshot({ model_id: "gpt-4.1-mini" }), [
        { role: "user", content: "こんにちは" },
      ]),
    ).toMatchObject({ reasoning_effort: "none" });
    expect(
      build_openai_compatible_payload(create_snapshot({ model_id: "qwen2.5-plus" }), [
        { role: "user", content: "こんにちは" },
      ]),
    ).toMatchObject({ enable_thinking: false });
    expect(
      build_openai_compatible_payload(create_snapshot({ model_id: "doubao-seed-1-5" }), [
        { role: "user", content: "こんにちは" },
      ]),
    ).toMatchObject({ reasoning_effort: "minimal" });
    expect(
      build_openai_compatible_payload(create_snapshot({ model_id: "mimo-v1-flash" }), [
        { role: "user", content: "こんにちは" },
      ]),
    ).toMatchObject({ thinking: { type: "disabled" } });
  });

  it("空消息在协议边界直接阻断", () => {
    expect(() => normalize_chat_messages([{ role: "user", content: "   " }])).toThrow(
      "request.validation_failed",
    );
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
