import { describe, expect, it } from "vitest";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import { GoogleTransport } from "./google-transport";
import type { ProviderClientResolver } from "./transport-types";

describe("GoogleTransport", () => {
  it("归一 Gemini stream 的正文、思考和 token 用量", async () => {
    const transport = new GoogleTransport(
      create_pool(
        [],
        [
          {
            candidates: [
              {
                content: {
                  parts: [{ text: " 思考 ", thought: true }, { text: " 你好" }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 3,
            },
          },
          {
            text: "，世界 ",
            usageMetadata: {
              candidatesTokenCount: 5,
            },
          },
        ],
      ),
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
    });
  });

  it("把 AbortSignal 写入 Google SDK 的 GenerateContentConfig", async () => {
    const captured_payloads: unknown[] = [];
    const transport = new GoogleTransport(create_pool(captured_payloads));
    const controller = new AbortController();
    const policy = create_policy({
      payload: {
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: "こんにちは" }] }],
        config: { temperature: 0.2 },
      },
    });

    await transport.send(policy, controller.signal);

    expect(captured_payloads).toHaveLength(1);
    expect(captured_payloads[0]).toMatchObject({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.2,
        abortSignal: controller.signal,
      },
    });
  });

  it("生成请求副本时不修改 policy.payload", async () => {
    const captured_payloads: unknown[] = [];
    const transport = new GoogleTransport(create_pool(captured_payloads));
    const controller = new AbortController();
    const policy = create_policy({
      payload: {
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: "こんにちは" }] }],
        config: {},
      },
    });

    await transport.send(policy, controller.signal);

    expect(policy.payload["config"]).toEqual({});
  });
});

function create_pool(
  captured_payloads: unknown[],
  chunks: unknown[] = [
    {
      text: "你好",
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 2,
      },
    },
  ],
): ProviderClientResolver {
  return {
    get_client: <T>() =>
      ({
        models: {
          generateContentStream: async (payload: unknown) => {
            captured_payloads.push(payload);
            return create_stream(chunks);
          },
        },
      }) as T,
  };
}

// create_stream 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
async function* create_stream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function create_policy(overrides: Partial<ResolvedRequestPolicy> = {}): ResolvedRequestPolicy {
  return {
    provider: "google",
    api_format: "Google",
    base_url: "https://example.com",
    model_id: "gemini-2.5-flash",
    headers: {},
    api_keys: ["key"],
    messages: [{ role: "user", content: "こんにちは" }],
    payload: {
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "こんにちは" }] }],
      config: {},
    },
    timeout_ms: 120_000,
    response_mode: "chat-stream",
    diagnostics: {},
    ...overrides,
  };
}
