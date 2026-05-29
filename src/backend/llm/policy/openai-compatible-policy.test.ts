import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import {
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
