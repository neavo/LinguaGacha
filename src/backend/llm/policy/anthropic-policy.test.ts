import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
  apply_anthropic_one_shot_request_overrides,
  apply_anthropic_request_overrides,
} from "./anthropic-policy";

describe("Anthropic 请求规则", () => {
  it("thinking 开启时使用 adaptive 与 effort 档位并删除采样字段", () => {
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

    expect(payload["thinking"]).toEqual({ type: "adaptive" });
    expect(payload["output_config"]).toEqual({ effort: "high" });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(payload).not.toHaveProperty("thinking.budget_tokens");
  });

  it("共享覆盖用项目档位替换 Pi thinking 并保留 output_config 其它字段", () => {
    const source = {
      messages: [{ role: "user", content: "こんにちは" }],
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      temperature: 0.7,
      top_p: 0.8,
    };
    const payload = apply_anthropic_request_overrides(
      source,
      create_snapshot({
        thinking_level: "MEDIUM",
        extra_body: {
          thinking: { type: "enabled", budget_tokens: 4096 },
          output_config: { effort: "low", format: { type: "json_schema" } },
        },
      }),
    );

    expect(payload).toMatchObject({
      messages: source.messages,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(source).toHaveProperty("thinking.type", "adaptive");
    expect(source).toHaveProperty("output_config.effort", "high");
  });

  it("不按模型 ID 匹配思考能力", () => {
    const payload = apply_anthropic_request_overrides(
      {},
      create_snapshot({
        model_id: "provider-defined-model",
        thinking_level: "XHIGH",
      }),
    );

    expect(payload).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "xhigh" },
    });
  });

  it("OFF 显式关闭 thinking 并移除用户扩展中的 effort", () => {
    const payload = apply_anthropic_request_overrides(
      {},
      create_snapshot({
        thinking_level: "OFF",
        extra_body: {
          output_config: { effort: "xhigh", format: { type: "json_schema" } },
        },
      }),
    );

    expect(payload).toEqual({
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema" } },
    });
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
