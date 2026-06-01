import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { LLMClient, ProviderClientPool } from "./llm-client";
import type { LLMRequestBody, LLMRequestResult } from "./llm-types";
import type { ResolvedRequestPolicy } from "./policy/policy-types";
import type { RequestTransport } from "./transport/transport-types";

const TEST_USER_AGENT = "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)";

afterEach(() => {
  vi.useRealTimers();
});

describe("LLMClient", () => {
  it("按已解析 provider 调用对应 transport 并返回请求结果", async () => {
    const captured_providers: string[] = [];
    const client = new LLMClient({
      userAgent: TEST_USER_AGENT,
      transports: {
        google: {
          send: async (policy) => {
            captured_providers.push(policy.provider);
            return create_result({ response_result: "你好" });
          },
        },
      },
    });

    const result = await client.request(
      create_body({ api_format: "Google", model_id: "gemini-2.5-flash" }),
      new AbortController().signal,
    );

    expect(result.response_result).toBe("你好");
    expect(captured_providers).toEqual(["google"]);
  });

  it("transport 抛错时返回完整错误结果", async () => {
    const client = new LLMClient({
      userAgent: TEST_USER_AGENT,
      transports: {
        "openai-compatible": {
          send: async () => {
            throw new Error("供应商爆炸");
          },
        },
      },
    });

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result).toMatchObject(
      create_result({
        request_error: {
          name: "Error",
          message: "供应商爆炸",
          context: {
            api_format: "OpenAI",
            model_id: "gpt-5-mini",
            provider: "openai-compatible",
            run_id: "run-1",
            work_unit_id: "unit-1",
          },
        },
      }),
    );
    expect(result.request_error?.stack).toContain("供应商爆炸");
  });

  it("外部取消请求时返回 cancelled 结果", async () => {
    const controller = new AbortController();
    const client = new LLMClient({
      userAgent: TEST_USER_AGENT,
      transports: {
        "openai-compatible": create_abortable_transport(),
      },
    });

    const request = client.request(create_body(), controller.signal);
    controller.abort();

    expect(await request).toEqual(create_result({ cancelled: true }));
  });

  it("请求超过策略超时时返回 timeout 结果", async () => {
    vi.useFakeTimers();
    const client = new LLMClient({
      userAgent: TEST_USER_AGENT,
      transports: {
        "openai-compatible": create_abortable_transport(),
      },
    });

    const request = client.request(
      create_body({}, { request_timeout: 1 }),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await request).toEqual(create_result({ timeout: true }));
  });
});

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

function create_body(
  model_overrides: Record<string, ApiJsonValue> = {},
  config_snapshot: ApiJsonValue = { request_timeout: 120 },
): LLMRequestBody {
  return {
    run_id: "run-1",
    work_unit_id: "unit-1",
    model: {
      api_format: "OpenAI",
      api_key: "key",
      api_url: "https://example.com/v1",
      generation: {},
      model_id: "gpt-5-mini",
      request: {},
      thinking: { level: "OFF" },
      threshold: { output_token_limit: 4096 },
      ...model_overrides,
    },
    config_snapshot,
    messages: [{ role: "user", content: "こんにちは" }],
  };
}

function create_abortable_transport(): RequestTransport {
  return {
    send: async (_policy: ResolvedRequestPolicy, signal: AbortSignal) =>
      new Promise<LLMRequestResult>((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("请求已中止"));
          return;
        }
        signal.addEventListener("abort", () => reject(new Error("请求已中止")), { once: true });
      }),
  };
}

function create_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
  return {
    response_think: "",
    response_result: "",
    input_tokens: 0,
    output_tokens: 0,
    cancelled: false,
    timeout: false,
    degraded: false,
    ...overrides,
  };
}
