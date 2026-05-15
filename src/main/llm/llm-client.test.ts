import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { ProviderClientPool } from "./llm-client";

describe("ProviderClientPool", () => {
  it("相同 key/baseUrl/header 多次请求只创建一次 client", () => {
    const pool = new ProviderClientPool(() => ({ id: crypto.randomUUID() }));
    const first = pool.get_client(create_request({ api_key: "key-a" }));
    const second = pool.get_client(create_request({ api_key: "key-a" }));

    expect(second).toBe(first);
    expect(pool.get_create_count_for_test()).toBe(1);
  });

  it("不同 apiKey 或 headers 会创建不同 client", () => {
    const pool = new ProviderClientPool(() => ({ id: crypto.randomUUID() }));
    const first = pool.get_client(create_request({ api_key: "key-a" }));
    const second = pool.get_client(create_request({ api_key: "key-b" }));
    const third = pool.get_client(create_request({ headers: { "X-Test": "yes" } }));

    expect(second).not.toBe(first);
    expect(third).not.toBe(first);
    expect(pool.get_create_count_for_test()).toBe(3);
  });
});

/**
 * 构造 client pool key 输入，测试只覆盖被 overrides 改动的字段。
 */
function create_request(overrides: Partial<Parameters<ProviderClientPool["get_client"]>[0]> = {}) {
  return {
    provider: "openai-compatible" as const,
    api_format: "OpenAI",
    base_url: "https://example.com/v1",
    api_key: "key",
    timeout_ms: 120_000,
    headers: {},
    ...overrides,
  };
}
