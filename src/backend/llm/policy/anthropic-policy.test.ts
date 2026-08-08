import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_anthropic_one_shot_request_overrides,
  apply_anthropic_request_overrides,
} from "./anthropic-policy";

describe("Anthropic 请求规则", () => {
  it("thinking 开启时删除不允许组合的采样字段", () => {
    const payload = apply_anthropic_one_shot_request_overrides(
      {
        messages: [],
        temperature: 0.4,
        top_p: 0.7,
      },
      create_snapshot({
        thinking_level: "HIGH",
        generation: { top_p_custom_enable: true, top_p: 0.6 },
      }),
    );

    expect(payload["thinking"]).toEqual({
      type: "enabled",
      budget_tokens: expect.any(Number),
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
  });

  it("共享覆盖用项目预算替换 Pi thinking 且不修改输入", () => {
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
      thinking: { type: "enabled", budget_tokens: expect.any(Number) },
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
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
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
