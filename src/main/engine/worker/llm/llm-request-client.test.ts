import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { ApiJsonValue } from "../../../api/api-types";
import { PiAiLlmRequestClient } from "./llm-request-client";

describe("PiAiLlmRequestClient", () => {
  it("把 pi-ai 流式事件归一为旧 worker 响应字段", async () => {
    const app_root = await create_app_root();
    const captured: Array<{
      context: Context;
      model: Model<Api>;
      options?: Record<string, unknown>;
    }> = [];
    const client = new PiAiLlmRequestClient({
      appRoot: app_root,
      now: () => 123,
      stream: (model, context, options) => {
        captured.push({ context, model, options });
        return create_event_stream([
          { type: "thinking_delta", contentIndex: 0, delta: "思考" },
          { type: "text_delta", contentIndex: 0, delta: '{"0":"你' },
          { type: "text_delta", contentIndex: 0, delta: '好"}' },
          { type: "done", reason: "stop", message: create_message({ input: 4, output: 5 }) },
        ]);
      },
    });

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result).toEqual({
      response_think: "思考",
      response_result: '{"0":"你好"}',
      input_tokens: 4,
      output_tokens: 5,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
    });
    expect(captured[0]?.context).toEqual({
      systemPrompt: "系统甲\n\n系统乙",
      messages: [{ role: "user", content: "用户内容", timestamp: 123 }],
    });
    expect(captured[0]?.model).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      id: "gpt-5-mini",
    });
    expect(captured[0]?.options).toMatchObject({
      apiKey: "key-1",
      cacheRetention: "none",
      maxRetries: 0,
      timeoutMs: 125000,
    });
  });

  it("把 SakuraLLM 纯文本行转换为 JSON map", async () => {
    const client = new PiAiLlmRequestClient({
      appRoot: await create_app_root(),
      stream: () =>
        create_event_stream([
          { type: "text_end", contentIndex: 0, content: "第一行\n第二行" },
          { type: "done", reason: "stop", message: create_message({ input: 1, output: 2 }) },
        ]),
    });

    const result = await client.request(
      create_body({ api_format: "SakuraLLM", model_id: "sakura" }),
      new AbortController().signal,
    );

    expect(result.response_result).toBe('{"0":"第一行","1":"第二行"}');
  });

  it("供应商返回工具调用时归一为错误", async () => {
    const client = new PiAiLlmRequestClient({
      appRoot: await create_app_root(),
      stream: () =>
        create_event_stream([
          {
            type: "toolcall_end",
            contentIndex: 0,
            toolCall: { type: "toolCall", id: "tool-1", name: "search", arguments: {} },
          },
          { type: "done", reason: "toolUse", message: create_message({ stopReason: "toolUse" }) },
        ]),
    });

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result.response_result).toBe("");
    expect(result.error).toContain("工具调用");
  });

  it("检测到流式退化后返回 degraded", async () => {
    const client = new PiAiLlmRequestClient({
      appRoot: await create_app_root(),
      stream: () =>
        create_event_stream([
          { type: "text_delta", contentIndex: 0, delta: "复".repeat(50) },
          { type: "done", reason: "stop", message: create_message() },
        ]),
    });

    const result = await client.request(create_body(), new AbortController().signal);

    expect(result.degraded).toBe(true);
    expect(result.response_result).toBe("");
  });

  it("任务请求按模型 key 列表在当前 worker 内轮换", async () => {
    const captured_keys: unknown[] = [];
    const client = new PiAiLlmRequestClient({
      appRoot: await create_app_root(),
      stream: (_model, _context, options) => {
        captured_keys.push(options?.["apiKey"]);
        return create_event_stream([
          { type: "text_end", contentIndex: 0, content: "{}" },
          { type: "done", reason: "stop", message: create_message() },
        ]);
      },
    });
    const body = create_body({ api_key: "key-a\nkey-b" });

    await client.request(body, new AbortController().signal);
    await client.request(body, new AbortController().signal);
    await client.request(body, new AbortController().signal);

    expect(captured_keys).toEqual(["key-a", "key-b", "key-a"]);
  });
});

/**
 * 生成最小 appRoot，避免客户端测试读取仓库真实 version.txt
 */
async function create_app_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-pi-ai-client-"));
  await writeFile(path.join(app_root, "version.txt"), "1.2.3", "utf-8");
  return app_root;
}

/**
 * 构造客户端请求体，默认覆盖 OpenAI-compatible 的主链路字段
 */
function create_body(model_overrides: Record<string, ApiJsonValue> = {}): {
  run_id: string;
  work_unit_id: string;
  model: ApiJsonValue;
  config_snapshot: ApiJsonValue;
  messages: Array<{ role: "system" | "user"; content: string }>;
} {
  return {
    run_id: "run-1",
    work_unit_id: "unit-1",
    model: {
      api_format: "OpenAI",
      api_key: "key-1",
      api_url: "https://example.com/v1/chat/completions",
      model_id: "gpt-5-mini",
      threshold: { input_token_limit: 8192, output_token_limit: 4096 },
      ...model_overrides,
    },
    config_snapshot: { request_timeout: 120 },
    messages: [
      { role: "system", content: "系统甲" },
      { role: "system", content: "系统乙" },
      { role: "user", content: "用户内容" },
    ],
  };
}

/**
 * 用 async generator 模拟 pi-ai 事件流，避免测试触碰真实网络
 */
async function* create_event_stream(
  events: Array<Partial<AssistantMessageEvent> & { type: AssistantMessageEvent["type"] }>,
): AsyncIterable<AssistantMessageEvent> {
  for (const event of events) {
    yield with_partial(event);
  }
}

/**
 * pi-ai 增量事件要求携带 partial；测试只关心 type 专属字段，所以统一补齐
 */
function with_partial(
  event: Partial<AssistantMessageEvent> & { type: AssistantMessageEvent["type"] },
): AssistantMessageEvent {
  if (event.type === "done" || event.type === "error") {
    return event as AssistantMessageEvent;
  }
  return { partial: create_message(), ...event } as AssistantMessageEvent;
}

/**
 * 创建完整 AssistantMessage，确保 done/error 事件拥有 usage 与 stopReason
 */
function create_message(
  overrides: Partial<AssistantMessage> & { input?: number; output?: number } = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-5-mini",
    usage: {
      input: overrides.input ?? 0,
      output: overrides.output ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: (overrides.input ?? 0) + (overrides.output ?? 0),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: overrides.stopReason ?? "stop",
    timestamp: 123,
    ...overrides,
  };
}
