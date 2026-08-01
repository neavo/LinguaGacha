import { describe, expect, it } from "vitest";

import { patch_top_p, resolve_max_tokens_for_request } from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

function create_snapshot(overrides: Partial<ModelRequestSnapshot> = {}): ModelRequestSnapshot {
  return {
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
  it.each(["top_p", "topP"] as const)("只把显式启用的 top_p 写入 %s", (target_key) => {
    const enabled_payload: Record<string, unknown> = {};
    patch_top_p(enabled_payload, { top_p: 0.8, top_p_custom_enable: true }, target_key);
    expect(enabled_payload).toEqual({ [target_key]: 0.8 });

    const disabled_payload: Record<string, unknown> = {};
    patch_top_p(disabled_payload, { top_p: 0.8, top_p_custom_enable: false }, target_key);
    expect(disabled_payload).toEqual({});
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
