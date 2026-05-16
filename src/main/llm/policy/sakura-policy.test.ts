import { describe, expect, it } from "vitest";

import type { ModelRequestSnapshot } from "./policy-types";
import { build_sakura_payload, normalize_sakura_sdk_base_url } from "./sakura-policy";

describe("sakura-policy", () => {
  it("SakuraLLM baseUrl 去掉 chat completions 路径并保留接口根路径", () => {
    expect(normalize_sakura_sdk_base_url("https://sakura.example/v1/chat/completions/")).toBe(
      "https://sakura.example/v1",
    );
  });

  it("构造 SakuraLLM payload 时使用 chat completions 形态和启用的生成参数", () => {
    const payload = build_sakura_payload(
      create_snapshot({
        generation: {
          temperature_custom_enable: true,
          temperature: 0.5,
          top_p_custom_enable: true,
          top_p: 0.8,
        },
        extra_body: { custom_flag: true },
      }),
      [
        { role: "system", content: " 系统约束 " },
        { role: "user", content: " こんにちは " },
      ],
    );

    expect(payload).toMatchObject({
      model: "sakura-v1",
      messages: [
        { role: "system", content: "系统约束" },
        { role: "user", content: "こんにちは" },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 4096,
      temperature: 0.5,
      top_p: 0.8,
      custom_flag: true,
    });
  });

  it("空 SakuraLLM 消息在协议边界直接阻断", () => {
    expect(() =>
      build_sakura_payload(create_snapshot(), [{ role: "user", content: "   " }]),
    ).toThrow("LLM 请求 messages 为空。");
  });
});

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "sakura",
    api_format: "SakuraLLM",
    api_keys: ["key"],
    base_url: "https://sakura.example/v1",
    model_id: "sakura-v1",
    headers: {},
    extra_body: {},
    generation: {},
    output_token_limit: 4096,
    thinking_level: "OFF",
    ...overrides,
  };
}
