import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_anthropic_request_overrides,
  build_anthropic_payload,
  build_anthropic_thinking_payload,
} from "./anthropic-policy";

describe("anthropic-policy", () => {
  it("构造 Claude payload 时把 system 独立出来并保留正文消息", () => {
    const payload = build_anthropic_payload(create_snapshot({ output_token_limit: 0 }), [
      { role: "system", content: " 系统约束 " },
      { role: "system", content: " 输出简体中文 " },
      { role: "user", content: " こんにちは " },
    ]);

    expect(payload).toMatchObject({
      model: "claude-sonnet-4-5",
      system: "系统约束\n\n输出简体中文",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: true,
      max_tokens: 8192,
      thinking: { type: "disabled" },
    });
  });

  it("Claude thinking 开启时删除 provider 不允许组合的采样字段", () => {
    const payload = build_anthropic_payload(
      create_snapshot({
        thinking_level: "HIGH",
        generation: {
          temperature_custom_enable: true,
          temperature: 0.4,
          top_p_custom_enable: true,
          top_p: 0.7,
        },
        extra_body: {
          presence_penalty: 0.2,
          frequency_penalty: 0.3,
        },
      }),
      [{ role: "user", content: "こんにちは" }],
    );

    expect(payload["thinking"]).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(payload["temperature"]).toBeUndefined();
    expect(payload["top_p"]).toBeUndefined();
    expect(payload["presence_penalty"]).toBeUndefined();
    expect(payload["frequency_penalty"]).toBeUndefined();
  });

  it("非 Claude thinking 模型不写入 thinking 字段", () => {
    expect(
      build_anthropic_thinking_payload({ model_id: "claude-3-5-haiku", thinking_level: "HIGH" }),
    ).toBeNull();
  });

  it("共享覆盖规则用项目预算替换 Pi thinking 且不修改输入", () => {
    const source = {
      messages: [{ role: "user", content: "こんにちは" }],
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      temperature: 0.7,
      top_p: 0.8,
    };

    const payload = apply_anthropic_request_overrides(
      source,
      create_snapshot({ thinking_level: "MEDIUM" }),
    );

    expect(payload).toMatchObject({
      messages: source.messages,
      thinking: { type: "enabled", budget_tokens: 1536 },
    });
    expect(payload).not.toHaveProperty("output_config");
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(source).toHaveProperty("thinking.type", "adaptive");
  });

  it("不支持的模型只保留用户显式 extra_body thinking", () => {
    const payload = apply_anthropic_request_overrides(
      { thinking: { type: "adaptive" }, output_config: { effort: "high" } },
      create_snapshot({
        model_id: "claude-3-5-haiku",
        thinking_level: "HIGH",
        extra_body: { thinking: { type: "enabled", budget_tokens: 4096 } },
      }),
    );

    expect(payload).toEqual({ thinking: { type: "enabled", budget_tokens: 4096 } });
  });

  it("只有 system 消息时在协议边界直接阻断", () => {
    expect(() =>
      build_anthropic_payload(create_snapshot(), [{ role: "system", content: "系统约束" }]),
    ).toThrow("request.validation_failed");
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "anthropic",
    api_format: "Anthropic",
    api_keys: ["key"],
    base_url: "https://api.anthropic.com",
    model_id: "claude-sonnet-4-5",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
