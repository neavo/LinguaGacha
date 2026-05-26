import { describe, expect, it } from "vitest";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import { SakuraTransport } from "./sakura-transport";
import type { ProviderClientResolver } from "./transport-types";

describe("SakuraTransport", () => {
  it("把 SakuraLLM 逐行文本响应转换为 ResponseDecoder 可消费的 JSON map", async () => {
    const transport = new SakuraTransport(
      create_pool([
        {
          choices: [{ delta: { content: " 第一行\n第二行 " }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 5 },
        },
      ]),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(JSON.parse(result.response_result)).toEqual({
      "0": "第一行",
      "1": "第二行",
    });
    expect(result).toMatchObject({
      input_tokens: 3,
      output_tokens: 5,
    });
  });

  it("父级 transport 返回错误时保留错误结果不做行转换", async () => {
    const transport = new SakuraTransport(
      create_pool([
        {
          choices: [{ delta: { content: "半截译文" }, finish_reason: "length" }],
        },
      ]),
    );

    const result = await transport.send(create_policy(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      request_error: {
        message: "供应商返回长度截断。",
      },
    });
  });
});

// create_pool 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_pool(chunks: unknown[]): ProviderClientResolver {
  return {
    get_client: <T>() =>
      ({
        chat: {
          completions: {
            create: async () => create_stream(chunks),
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

// create_policy 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_policy(overrides: Partial<ResolvedRequestPolicy> = {}): ResolvedRequestPolicy {
  return {
    provider: "sakura",
    api_format: "SakuraLLM",
    base_url: "https://sakura.example/v1",
    model_id: "sakura-v1",
    headers: {},
    api_keys: ["key"],
    messages: [{ role: "user", content: "こんにちは" }],
    payload: {
      model: "sakura-v1",
      messages: [{ role: "user", content: "こんにちは" }],
      stream: true,
    },
    timeout_ms: 120_000,
    response_mode: "sakura-lines",
    diagnostics: {},
    ...overrides,
  };
}
