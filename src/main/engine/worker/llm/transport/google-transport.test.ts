import { describe, expect, it } from "vitest";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import { GoogleTransport } from "./google-transport";
import type { ProviderClientResolver } from "./transport-types";

describe("GoogleTransport", () => {
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

function create_pool(captured_payloads: unknown[]): ProviderClientResolver {
  return {
    get_client: <T>() =>
      ({
        models: {
          generateContentStream: async (payload: unknown) => {
            captured_payloads.push(payload);
            return create_stream();
          },
        },
      }) as T,
  };
}

async function* create_stream(): AsyncGenerator<unknown> {
  yield {
    text: "你好",
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 2,
    },
  };
}

function create_policy(
  overrides: Partial<ResolvedRequestPolicy> = {},
): ResolvedRequestPolicy {
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
