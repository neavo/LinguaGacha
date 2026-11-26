import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { JsonRecord } from "../../domain/json";
import { create_pi_model_catalog_fixture } from "../../test/pi-model-catalog-fixture";
import { ProxyHttpClient } from "../network/proxy-http-client";
import { listen } from "../network/proxy-test-support";
import { LLMClient } from "./llm-client";
import type { LLMRequestBody } from "./llm-types";

const catalog = create_pi_model_catalog_fixture([]);
const userAgent = "LinguaGacha/test";
const client = new LLMClient({ userAgent, catalog });
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("OAuth 沿用任务绑定账户，每次派发重新读取凭据", async () => {
  const resolve = vi
    .fn<(session_id: string) => Promise<{ apiKey: string }>>()
    .mockResolvedValueOnce({ apiKey: "token-one" })
    .mockResolvedValueOnce({ apiKey: "token-two" });
  const auth_client = new LLMClient({
    userAgent,
    catalog,
    auth: { bind: () => "other-session", resolve },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    sse({ type: "response.completed", response: { id: "fixture", status: "completed" } }),
  );
  vi.stubGlobal("fetch", fetch);

  const body = {
    ...request_body({
      api_format: "OpenAIResponses",
      api_url: "https://api.openai.com/v1",
      auth_type: "oauth",
    }),
    auth_session: "bound-session",
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await auth_client.request(body, new AbortController().signal);
    expect(result.request_error).toBeUndefined();
  }
  expect(resolve.mock.calls.map(([session]) => session)).toEqual([
    "bound-session",
    "bound-session",
  ]);
  expect(
    fetch.mock.calls.map(([input, init]) => new Request(input, init).headers.get("authorization")),
  ).toEqual(["Bearer token-one", "Bearer token-two"]);
});

it.each([
  [
    "OpenAIResponses",
    "incomplete.content_filter",
    [
      {
        type: "response.incomplete",
        response: {
          id: "fixture",
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
        },
      },
    ],
  ],
  [
    "Anthropic",
    "refusal",
    [
      {
        type: "message_start",
        message: { id: "fixture", usage: { input_tokens: 1, output_tokens: 0 } },
      },
      { type: "message_delta", delta: { stop_reason: "refusal" }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
    ],
  ],
] as const)("%s 将供应商的明确拒绝归为内容失败", async (api_format, rawStopReason, events) => {
  vi.stubGlobal("fetch", async () => sse(...events));
  const result = await client.request(request_body({ api_format }), new AbortController().signal);
  expect(result.response_error).toMatchObject({ context: { rawStopReason } });
  expect(result.request_error).toBeUndefined();
});

it.each([
  { usage: undefined, expected: { input_tokens: 0, reasoning_tokens: 0, output_tokens: 0 } },
  { usage: "3", expected: { input_tokens: 10, reasoning_tokens: 3, output_tokens: 5 } },
  { usage: "12", expected: { input_tokens: 10, reasoning_tokens: 8, output_tokens: 0 } },
])("归一真实用量并区分 SDK 补零（思考计数 $usage）", async ({ usage, expected }) => {
  vi.stubGlobal("fetch", async () =>
    completion(
      "stop",
      { content: "  第一行\n第二行  ", reasoning_content: " 推理 " },
      usage === undefined
        ? undefined
        : {
            prompt_tokens: "10",
            completion_tokens: "8",
            prompt_tokens_details: { cached_tokens: "2", cache_write_tokens: "3" },
            completion_tokens_details: { reasoning_tokens: usage },
          },
    ),
  );
  await expect(client.request(request_body(), new AbortController().signal)).resolves.toMatchObject(
    {
      ...expected,
      response_think: "推理",
      response_result: "第一行\n第二行",
      usage_complete: false,
    },
  );
});

it("非法扩展头在派发前归一为请求错误", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const body = request_body({
    request: { extra_headers_custom_enable: true, extra_headers: { "invalid header": "value" } },
  });
  const result = await client.request(body, new AbortController().signal);
  expect(result.request_error).toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
});

it("正常终态的空正文交由调用方校验", async () => {
  vi.stubGlobal("fetch", async () => completion("stop", {}));
  const result = await client.request(request_body(), new AbortController().signal);
  expect(result.response_result).toBe("");
  expect(result.request_error).toBeUndefined();
  expect(result.response_error).toBeUndefined();
});

it.each(["length", "tool_calls", "content_filter"] as const)(
  "%s 丢弃部分正文并保留内容失败的用量",
  async (reason) => {
    vi.stubGlobal("fetch", async () =>
      completion(
        reason,
        {
          content: "部分正文",
          ...(reason === "tool_calls"
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "unexpected", arguments: "{}" },
                  },
                ],
              }
            : {}),
        },
        { prompt_tokens: 4, completion_tokens: 5 },
      ),
    );
    const result = await client.request(request_body(), new AbortController().signal);
    expect(result).toMatchObject({
      response_result: "",
      input_tokens: 4,
      output_tokens: 5,
      response_error: { context: { rawStopReason: reason } },
    });
    expect(result.request_error).toBeUndefined();
  },
);

it.each([
  ["https://generativelanguage.googleapis.com/v1", "SAFETY", "response_error"],
  ["https://aiplatform.googleapis.com/v1", "BLOCKLIST", "response_error"],
  ["https://generativelanguage.googleapis.com/v1", "OTHER", "request_error"],
] as const)("Google %s 的提示词拦截 %s 进入 %s", async (api_url, blockReason, channel) => {
  vi.stubGlobal("fetch", async () => sse({ promptFeedback: { blockReason } }));
  const body = request_body({ api_format: "Google", api_url });
  const { request_error, response_error } = await client.request(
    body,
    new AbortController().signal,
  );
  expect({ request_error, response_error }).toEqual({
    [channel]: expect.objectContaining({ message: expect.stringContaining(blockReason) }),
  });
});

it.each(["OpenAI", "OpenAIResponses", "Anthropic"] as const)(
  "%s 把 HTTP 日期转换为调度器使用的等待时长",
  async (api_format) => {
    const retry_at = new Date(Date.now() + 90_000).toUTCString();
    vi.stubGlobal("fetch", async () =>
      Response.json(error_body(429), { status: 429, headers: { "retry-after": retry_at } }),
    );
    const result = await client.request(request_body({ api_format }), new AbortController().signal);
    expect(result).toMatchObject({ http_status: 429, request_error: expect.any(Object) });
    expect(result.retry_after_ms).toBe(Date.parse(retry_at) - result.http_received_at!);
  },
);

it("Google 并行请求经应用代理保留原始响应头和各自的 HTTP 状态", async () => {
  const root = await listen(
    createServer((request, response) => {
      request.resume();
      if (request.url?.startsWith("/disconnect")) {
        request.socket.destroy();
        return;
      }
      const limited = request.url?.startsWith("/limited");
      const status = limited ? 429 : 401;
      response.writeHead(status, {
        "content-type": "application/json",
        "retry-after": limited ? "90" : "1.5",
      });
      response.end(JSON.stringify(error_body(status)));
    }),
    cleanups,
  );
  const proxy = new ProxyHttpClient({ resolveProxy: async () => "DIRECT" });
  proxy.install_as_global_fetch();
  cleanups.push(() => proxy.dispose());

  const [limited, unauthorized, disconnected] = await Promise.all(
    ["limited", "unauthorized", "disconnect"].map((route) =>
      client.request(
        request_body({ api_format: "Google", api_url: root + "/" + route + "/v1" }),
        new AbortController().signal,
      ),
    ),
  );
  expect(limited).toMatchObject({
    http_status: 429,
    retry_after_ms: 90_000,
    request_error: expect.any(Object),
  });
  expect(unauthorized).toMatchObject({ http_status: 401, request_error: expect.any(Object) });
  expect(unauthorized).not.toHaveProperty("retry_after_ms");
  expect(disconnected).not.toHaveProperty("http_status");
  expect(disconnected?.request_error).toBeDefined();
});

it("已取消的请求不会派发", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort();
  const result = await client.request(request_body(), controller.signal);
  expect(result.cancelled).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  { cancel: true, timeout: false },
  { cancel: false, timeout: true },
  { cancel: true, timeout: true },
])("外部取消 $cancel 和总时限 $timeout 在迟到的失败前结算", async ({ cancel, timeout }) => {
  vi.useFakeTimers();
  const external = new AbortController();
  const dispatched = Promise.withResolvers<AbortSignal>();
  const response = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    dispatched.resolve(new Request(input, init).signal);
    return response.promise;
  });
  const pending = client.request(request_body({}, 1), external.signal);
  const signal = await dispatched.promise;
  if (cancel) external.abort();
  if (timeout) await vi.advanceTimersByTimeAsync(1_000);
  expect(signal.aborted).toBe(true);
  response.resolve(completion("content_filter", { content: "迟到的部分正文" }));

  const result = await pending;
  expect(result).toMatchObject({ timeout, cancelled: !timeout, response_result: "" });
  expect(result.request_error).toBeUndefined();
  expect(result.response_error).toBeUndefined();
});

/** 默认模型只用来走正式请求入口，各场景只覆盖关心的字段。 */
function request_body(model: JsonRecord = {}, timeout = 5): LLMRequestBody {
  return {
    run_id: "run",
    work_unit_id: "unit",
    model: {
      api_format: "OpenAI",
      api_url: "https://example.com/v1",
      api_key: "key",
      model_id: "fixture",
      ...model,
    },
    config_snapshot: { request_timeout: timeout },
    messages: [{ role: "user", content: "测试" }],
  };
}

/** 用供应商原始帧驱动 Pi，避免由测试预先替 SDK 解释终态。 */
function completion(reason: string, delta: JsonRecord, usage?: JsonRecord): Response {
  return sse({ choices: [{ index: 0, delta, finish_reason: reason }], usage });
}

function sse(...events: Array<{ type?: string; [field: string]: unknown }>): Response {
  const body = events
    .map((event) => {
      const name = event.type === undefined ? "" : "event: " + event.type + "\n";
      return name + "data: " + JSON.stringify(event) + "\n\n";
    })
    .join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function error_body(status: number) {
  return { error: { message: "请求失败", code: status, type: "api_error" } };
}
