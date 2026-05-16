import { describe, expect, it } from "vitest";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import { OpenAICompatibleTransport } from "./openai-compatible-transport";
import type { ProviderClientPoolRequest, ProviderClientResolver } from "./transport-types";

describe("OpenAICompatibleTransport", () => {
  it("归一 OpenAI-compatible stream 的正文、思考和 token 用量", async () => {
    const captured_requests: ProviderClientPoolRequest[] = [];
    const transport = new OpenAICompatibleTransport(
      create_pool(captured_requests, [
        {
          choices: [{ delta: { reasoning_content: " 思考 " } }],
          usage: { prompt_tokens: 3 },
        },
        {
          choices: [{ delta: { content: " 你好" } }],
        },
        {
          choices: [{ delta: { content: "，世界 " }, finish_reason: "stop" }],
          usage: { completion_tokens: 5 },
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
    expect(captured_requests[0]).toMatchObject({
      provider: "openai-compatible",
      api_key: "key",
      base_url: "https://example.com/v1",
    });
  });

  it("长度截断时清空正文并返回可展示错误", async () => {
    const transport = new OpenAICompatibleTransport(
      create_pool(
        [],
        [
          {
            choices: [{ delta: { content: "半截译文" }, finish_reason: "length" }],
            usage: { prompt_tokens: 2, completion_tokens: 4 },
          },
        ],
      ),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      input_tokens: 2,
      output_tokens: 4,
      error: "供应商返回长度截断。",
    });
  });

  it("检测到退化输出时返回 degraded 结果", async () => {
    const transport = new OpenAICompatibleTransport(
      create_pool(
        [],
        [
          {
            choices: [{ delta: { content: "哈".repeat(50) } }],
          },
        ],
      ),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      degraded: true,
    });
  });
});

function create_pool(
  captured_requests: ProviderClientPoolRequest[],
  chunks: unknown[],
): ProviderClientResolver {
  return {
    get_client: <T>(request: ProviderClientPoolRequest) => {
      captured_requests.push(request);
      return {
        chat: {
          completions: {
            create: async () => create_stream(chunks),
          },
        },
      } as T;
    },
  };
}

async function* create_stream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function create_policy(overrides: Partial<ResolvedRequestPolicy> = {}): ResolvedRequestPolicy {
  return {
    provider: "openai-compatible",
    api_format: "OpenAI",
    base_url: "https://example.com/v1",
    model_id: "gpt-5-mini",
    headers: {},
    api_keys: ["key"],
    messages: [{ role: "user", content: "こんにちは" }],
    payload: {
      model: "gpt-5-mini",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: true,
    },
    timeout_ms: 120_000,
    response_mode: "chat-stream",
    diagnostics: {},
    ...overrides,
  };
}
