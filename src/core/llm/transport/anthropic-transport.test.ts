import { describe, expect, it } from "vitest";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import { AnthropicTransport } from "./anthropic-transport";
import type { ProviderClientResolver } from "./transport-types";

describe("AnthropicTransport", () => {
  it("归一 Anthropic stream 的正文、思考和 token 用量", async () => {
    const transport = new AnthropicTransport(
      create_pool([
        {
          type: "content_block_delta",
          delta: { thinking: " 思考 " },
        },
        {
          type: "content_block_delta",
          delta: { text: " 你好，世界 " },
        },
        {
          message: {
            usage: { input_tokens: 3, output_tokens: 5 },
            stop_reason: "end_turn",
          },
        },
      ]),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toEqual({
      response_think: "思考",
      response_result: "你好，世界",
      input_tokens: 3,
      output_tokens: 5,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
    });
  });

  it("长度截断时清空正文并返回可展示错误", async () => {
    const transport = new AnthropicTransport(
      create_pool([
        {
          type: "content_block_delta",
          delta: { text: "半截译文" },
        },
        {
          message: {
            usage: { input_tokens: 2, output_tokens: 4 },
            stop_reason: "max_tokens",
          },
        },
      ]),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      input_tokens: 2,
      output_tokens: 4,
      error: "供应商返回长度截断。",
    });
  });
});

function create_pool(chunks: unknown[]): ProviderClientResolver {
  return {
    get_client: <T>() =>
      ({
        messages: {
          create: async () => create_stream(chunks),
        },
      }) as T,
  };
}

async function* create_stream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function create_policy(overrides: Partial<ResolvedRequestPolicy> = {}): ResolvedRequestPolicy {
  return {
    provider: "anthropic",
    api_format: "Anthropic",
    base_url: "https://api.anthropic.com",
    model_id: "claude-sonnet-4-5",
    headers: {},
    api_keys: ["key"],
    messages: [{ role: "user", content: "こんにちは" }],
    payload: {
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: true,
      max_tokens: 4096,
    },
    timeout_ms: 120_000,
    response_mode: "chat-stream",
    diagnostics: {},
    ...overrides,
  };
}
