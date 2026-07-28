import { describe, expect, it } from "vitest";

import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
    provider: "openai-compatible",
    api_format: "OpenAI",
    api_keys: ["k"],
    base_url: "https://example.test",
    model_id: "m",
    headers: {},
    extra_body: {},
    output_token_limit: 0,
    thinking_level: "OFF",
    ...overrides,
    generation: {
      ...overrides.generation,
    },
  };
}

describe("policy-shared", () => {
  it("只写入显式启用的 generation 字段", () => {
    const payload: Record<string, unknown> = {};
    patch_generation_fields(
      payload,
      {
        top_p: 0.8,
        top_p_custom_enable: true,
        frequency_penalty: 1,
        frequency_penalty_custom_enable: false,
      },
      {
        top_p: "top_p",
        frequency_penalty: "frequency_penalty",
      },
    );
    expect(payload).toEqual({ top_p: 0.8 });
  });

  it("thinking 开启时默认不发送 temperature", () => {
    const payload: Record<string, unknown> = {};
    patch_temperature(
      payload,
      create_snapshot({
        thinking_level: "LOW",
        generation: {
          temperature: 0.2,
          temperature_custom_enable: true,
        },
      }),
    );
    expect(payload).toEqual({});

    patch_temperature(
      payload,
      create_snapshot({
        thinking_level: "LOW",
        generation: {
          temperature: 0.2,
          temperature_custom_enable: true,
        },
      }),
      { allow_thinking_temperature: true },
    );
    expect(payload).toEqual({ temperature: 0.2 });
  });

  it("自动 token 上限可回落到 provider 默认值", () => {
    expect(
      resolve_max_tokens_for_request(create_snapshot({ output_token_limit: 0 }), {
        auto_value: 8192,
      }),
    ).toBe(8192);
    expect(resolve_max_tokens_for_request(create_snapshot({ output_token_limit: 128 }))).toBe(128);
    expect(resolve_max_tokens_for_request(create_snapshot({ output_token_limit: 0 }))).toBeNull();
  });
});
