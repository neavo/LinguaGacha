import { describe, expect, it } from "vitest";

import {
  build_request_headers,
  patch_top_p,
  resolve_max_tokens_for_request,
} from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

/** 构造请求事实，测试只替换当前规则消费的字段。 */
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
  const identity = { user_agent: "LinguaGacha/Test", session_id: "test-session" };

  it.each([
    ["https://opencode.ai/zen/v1", "test-session"],
    ["https://OPENCODE.AI/zen/go/v1/chat/completions", "test-session"],
    ["https://opencode.ai.example/v1", null],
    ["https://proxy.opencode.ai/v1", null],
    ["", null],
  ])("仅按官方 hostname 自动设置会话头：%s", (base_url, expected) => {
    const headers = build_request_headers(base_url, identity, {});
    expect(new Headers(headers).get("x-opencode-session")).toBe(expected);
  });

  it("扩展头按大小写不敏感覆盖默认身份，并保留 adapter 所需的 User-Agent 拼写", () => {
    expect(
      build_request_headers("https://opencode.ai/zen/go/v1", identity, {
        "X-OpenCode-Session": "manual-session",
        "user-agent": "Custom/1",
      }),
    ).toEqual({
      "User-Agent": "Custom/1",
      "x-opencode-session": "manual-session",
    });
  });

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
