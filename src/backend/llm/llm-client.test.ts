import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type ProviderStreams,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JsonRecord, JsonValue } from "../../domain/json";
import { LLMClient } from "./llm-client";
import type { LLMRequestBody, LLMRequestResult } from "./llm-types";

const api_mocks = vi.hoisted(() => ({
  openai: vi.fn<ProviderStreams["stream"]>(),
  responses: vi.fn<ProviderStreams["stream"]>(),
  anthropic: vi.fn<ProviderStreams["stream"]>(),
  google: vi.fn<ProviderStreams["stream"]>(),
  streamSimple: vi.fn<ProviderStreams["streamSimple"]>(),
}));

vi.mock("@earendil-works/pi-ai/api/openai-completions.lazy", () => ({
  openAICompletionsApi: () => ({
    stream: api_mocks.openai,
    streamSimple: api_mocks.streamSimple,
  }),
}));
vi.mock("@earendil-works/pi-ai/api/openai-responses.lazy", () => ({
  openAIResponsesApi: () => ({
    stream: api_mocks.responses,
    streamSimple: api_mocks.streamSimple,
  }),
}));
vi.mock("@earendil-works/pi-ai/api/anthropic-messages.lazy", () => ({
  anthropicMessagesApi: () => ({
    stream: api_mocks.anthropic,
    streamSimple: api_mocks.streamSimple,
  }),
}));
vi.mock("@earendil-works/pi-ai/api/google-generative-ai.lazy", () => ({
  googleGenerativeAIApi: () => ({
    stream: api_mocks.google,
    streamSimple: api_mocks.streamSimple,
  }),
}));

const TEST_USER_AGENT = "LinguaGacha/v1.2.3 (https://github.com/neavo/LinguaGacha)";

beforeEach(() => {
  api_mocks.openai.mockReset();
  api_mocks.responses.mockReset();
  api_mocks.anthropic.mockReset();
  api_mocks.google.mockReset();
  api_mocks.streamSimple.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LLMClient", () => {
  it("通过 Pi stream 返回正文、思考和 OpenAI token 口径", async () => {
    api_mocks.openai.mockImplementation(() =>
      completed_stream(
        create_message({
          content: [
            { type: "thinking", thinking: " 推理 " },
            { type: "text", text: " 你好 " },
          ],
          usage: create_usage({ input: 10, output: 7, cacheRead: 2, cacheWrite: 3 }),
        }),
        [" 你", "好 "],
      ),
    );
    const client = create_client();

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result).toEqual(
      create_result({
        response_think: "推理",
        response_result: "你好",
        input_tokens: 15,
        output_tokens: 7,
      }),
    );
    expect(api_mocks.openai).toHaveBeenCalledTimes(1);
    const options = api_mocks.openai.mock.calls[0]?.[2];
    expect(options).toMatchObject({
      maxRetries: 0,
      cacheRetention: "none",
    });
    expect(options).not.toHaveProperty("timeoutMs");
  });

  it.each([
    ["Anthropic", "anthropic"],
    ["Google", "google"],
  ] as const)("统一拆分 %s 的输入、思考和输出 token", async (api_format, mock_name) => {
    api_mocks.streamSimple.mockImplementation(() =>
      completed_stream(
        create_message({
          provider: mock_name,
          api: api_format === "Google" ? "google-generative-ai" : "anthropic-messages",
          content: [{ type: "text", text: "你好" }],
          usage: create_usage({ input: 10, output: 7, cacheRead: 2, reasoning: 2 }),
        }),
      ),
    );
    const client = create_client();

    const result = await client.request(
      create_body({
        api_format,
        model_id: api_format === "Google" ? "gemini-2.5-flash" : "claude-sonnet-4-5",
      }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      input_tokens: 12,
      reasoning_tokens: 2,
      output_tokens: 5,
    });
  });

  it("Responses completed 返回正文与 OpenAI token 口径", async () => {
    api_mocks.responses.mockImplementation(() =>
      completed_stream(
        create_message({
          api: "openai-responses",
          content: [{ type: "text", text: "你好" }],
          rawStopReason: "completed",
          usage: create_usage({ input: 10, output: 7, cacheRead: 2, cacheWrite: 3 }),
        }),
      ),
    );
    const client = create_client();

    const result = await client.request(
      create_body({ api_format: "OpenAIResponses" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ response_result: "你好", input_tokens: 15, output_tokens: 7 });
  });

  it.each([
    ["OpenAI", "length", "finish_reason"],
    ["OpenAI", "tool_calls", "finish_reason"],
    ["OpenAIResponses", "incomplete", "status"],
    ["Anthropic", "max_tokens", "stop_reason"],
    ["Anthropic", "tool_use", "stop_reason"],
  ] as const)("把 %s/%s 保持为当前请求错误", async (api_format, raw_reason, field) => {
    const mock =
      api_format === "Anthropic"
        ? api_mocks.streamSimple
        : api_format === "OpenAIResponses"
          ? api_mocks.responses
          : api_mocks.openai;
    const is_length =
      raw_reason === "length" || raw_reason === "incomplete" || raw_reason === "max_tokens";
    mock.mockImplementation(() =>
      completed_stream(
        create_message({
          api:
            api_format === "Anthropic"
              ? "anthropic-messages"
              : api_format === "OpenAIResponses"
                ? "openai-responses"
                : "openai-completions",
          provider: api_format === "Anthropic" ? "anthropic" : "openai",
          content: [
            { type: "thinking", thinking: "推理" },
            { type: "text", text: "部分正文" },
          ],
          rawStopReason: raw_reason,
          stopReason: is_length ? "length" : "toolUse",
          usage: create_usage({ input: 4, output: 5 }),
        }),
      ),
    );
    const client = create_client();

    const result = await client.request(create_body({ api_format }), new AbortController().signal);

    expect(result).toMatchObject({
      response_think: "推理",
      response_result: "",
      input_tokens: 4,
      output_tokens: 5,
      request_error: {
        message: is_length ? "供应商返回长度截断。" : "供应商返回工具调用，当前任务不支持。",
        context: { [field]: raw_reason },
      },
    });
  });

  it("把 Google 长度截断保持为当前请求错误", async () => {
    api_mocks.streamSimple.mockImplementation(() =>
      completed_stream(
        create_message({
          api: "google-generative-ai",
          provider: "google",
          content: [{ type: "text", text: "部分正文" }],
          rawStopReason: "MAX_TOKENS",
          stopReason: "length",
        }),
      ),
    );
    const client = create_client();

    const result = await client.request(
      create_body({ api_format: "Google", model_id: "gemini-2.5-flash" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      response_result: "",
      request_error: {
        message: "供应商返回长度截断。",
        context: { finish_reason: "MAX_TOKENS" },
      },
    });
  });

  it("正常终止但没有正文时返回当前请求错误", async () => {
    api_mocks.openai.mockImplementation(() =>
      completed_stream(
        create_message({
          rawStopReason: "stop",
          usage: create_usage({ input: 4 }),
        }),
      ),
    );
    const client = create_client();

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result).toMatchObject({
      response_result: "",
      input_tokens: 4,
      request_error: {
        message: "供应商未返回正文。",
        context: { finish_reason: "stop" },
      },
    });
  });

  it("Pi provider error 返回完整诊断并丢弃部分结果", async () => {
    api_mocks.openai.mockImplementation(() =>
      completed_stream(
        create_message({
          content: [{ type: "text", text: "部分正文" }],
          rawStopReason: "content_filter",
          stopReason: "error",
          errorMessage: "供应商爆炸",
        }),
      ),
    );
    const client = create_client();

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result).toMatchObject(
      create_result({
        request_error: {
          name: "Error",
          message: "供应商爆炸",
          context: {
            api_format: "OpenAI",
            model_id: "gpt-5-mini",
            run_id: "run-1",
            work_unit_id: "unit-1",
          },
        },
      }),
    );
  });

  it("外部取消丢弃已收到的部分结果", async () => {
    const controller = new AbortController();
    api_mocks.openai.mockImplementation((_model, _context, options) =>
      abortable_stream(options, "部分正文"),
    );
    const client = create_client();

    const request = client.request(create_body(), controller.signal);
    controller.abort();

    expect(await request).toEqual(create_result({ cancelled: true }));
  });

  it("请求开始前已取消时不启动 Pi stream", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = create_client();

    const result = await client.request(create_body(), controller.signal);

    expect(result).toEqual(create_result({ cancelled: true }));
    expect(api_mocks.openai).not.toHaveBeenCalled();
  });

  it("总时限到期后返回 timeout 并丢弃部分结果", async () => {
    vi.useFakeTimers();
    api_mocks.openai.mockImplementation((_model, _context, options) =>
      abortable_stream(options, "部分正文"),
    );
    const client = create_client();

    const request = client.request(
      create_body({}, { request_timeout: 1 }),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await request).toEqual(create_result({ timeout: true }));
  });

  it("timeout 与外部取消同时出现时保持 timeout 优先", async () => {
    vi.useFakeTimers();
    const external = new AbortController();
    const controlled = createAssistantMessageEventStream();
    api_mocks.openai.mockReturnValue(controlled);
    const client = create_client();

    const request = client.request(create_body({}, { request_timeout: 1 }), external.signal);
    external.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    controlled.push({
      type: "error",
      reason: "aborted",
      error: create_message({ stopReason: "aborted", errorMessage: "aborted" }),
    });

    expect(await request).toEqual(create_result({ timeout: true }));
  });

  it("检测流式退化后中止 Pi 并返回空 degraded 结果", async () => {
    api_mocks.openai.mockImplementation((_model, _context, options) => {
      const stream = abortable_stream(options);
      const partial = create_message();
      stream.push({ type: "text_delta", contentIndex: 0, delta: "啊".repeat(50), partial });
      return stream;
    });
    const client = create_client();

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result).toEqual(create_result({ degraded: true }));
  });

  it("Sakura 成功正文保留原始纯文本", async () => {
    api_mocks.openai.mockImplementation(() =>
      completed_stream(create_message({ content: [{ type: "text", text: " 第一行 \n 第二行 " }] })),
    );
    const client = create_client();

    const result = await client.request(
      create_body({ api_format: "SakuraLLM" }),
      new AbortController().signal,
    );

    expect(result.response_result).toBe("第一行 \n 第二行");
  });
});

/** 所有用例共用固定 User-Agent，供应商 transport 由 Backend 进程统一安装。 */
function create_client(): LLMClient {
  return new LLMClient({ userAgent: TEST_USER_AGENT });
}

/** 用 Pi 公开事件流构造确定的成功或 provider-error 终态。 */
function completed_stream(
  message: AssistantMessage,
  deltas: string[] = [],
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  for (const delta of deltas) {
    stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
  }
  if (
    message.stopReason === "error" ||
    message.stopReason === "aborted" ||
    message.stopReason === "pending"
  ) {
    stream.push({
      type: "error",
      reason: message.stopReason === "aborted" ? "aborted" : "error",
      error: message,
    });
  } else {
    stream.push({ type: "done", reason: message.stopReason, message });
  }
  return stream;
}

/** 模拟只在 AbortSignal 到达后结束的远端流，用于取消、超时和退化分支。 */
function abortable_stream(
  options: StreamOptions | undefined,
  partial_text = "",
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  if (partial_text !== "") {
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: partial_text,
      partial: create_message({ content: [{ type: "text", text: partial_text }] }),
    });
  }
  const abort = (): void => {
    stream.push({
      type: "error",
      reason: "aborted",
      error: create_message({ stopReason: "aborted", errorMessage: "请求已中止" }),
    });
  };
  if (options?.signal?.aborted) abort();
  else options?.signal?.addEventListener("abort", abort, { once: true });
  return stream;
}

function create_message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-5-mini",
    usage: create_usage(),
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

function create_usage(
  overrides: Partial<AssistantMessage["usage"]> = {},
): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

function create_body(
  model_overrides: JsonRecord = {},
  config_snapshot: JsonValue = { request_timeout: 120 },
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

function create_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
  return {
    response_think: "",
    response_result: "",
    input_tokens: 0,
    reasoning_tokens: 0,
    output_tokens: 0,
    cancelled: false,
    timeout: false,
    degraded: false,
    ...overrides,
  };
}
