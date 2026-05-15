import OpenAI from "openai";
import type { Stream } from "openai/streaming";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
import type {
  ProviderClientPoolRequest,
  ProviderClientResolver,
  RequestTransport,
} from "./transport-types";

/**
 * OpenAI-compatible 与 Sakura 共用 openai SDK client。
 */
export function create_openai_compatible_client(request: ProviderClientPoolRequest): OpenAI {
  return new OpenAI({
    apiKey: request.api_key,
    baseURL: request.base_url === "" ? undefined : request.base_url,
    defaultHeaders: request.headers,
    maxRetries: 0,
    timeout: request.timeout_ms,
  });
}

/**
 * OpenAICompatibleTransport 只发送 policy 生成的最终 payload，并把 official SDK stream 归一为 LLMRequestResult。
 */
export class OpenAICompatibleTransport implements RequestTransport {
  /**
   * pool 是 SDK client 的唯一来源，transport 内禁止直接 new client。
   */
  public constructor(private readonly pool: ProviderClientResolver) {}

  public async send(policy: ResolvedRequestPolicy, signal: AbortSignal): Promise<LLMRequestResult> {
    const client = this.pool.get_client<{ chat: { completions: { create: Function } } }>({
      provider: policy.provider,
      api_format: policy.api_format,
      base_url: policy.base_url,
      api_key: policy.api_keys[0] ?? "no_key_required",
      timeout_ms: policy.timeout_ms,
      headers: policy.headers,
    });
    const stream = await client.chat.completions.create(policy.payload, { signal });
    return this.collect_stream(stream as Stream<unknown>);
  }

  /**
   * 按 OpenAI chat chunks 归一正文、思考、usage 和 finish_reason。
   */
  protected async collect_stream(stream: AsyncIterable<unknown>): Promise<LLMRequestResult> {
    const detector = new LLMClientDegradationDetector();
    let response_result = "";
    let response_think = "";
    let input_tokens = 0;
    let output_tokens = 0;
    let error = "";
    for await (const chunk of stream) {
      const record = this.as_record(chunk);
      const choices = Array.isArray(record["choices"]) ? record["choices"] : [];
      const first_choice = this.as_record(choices[0]);
      const delta = this.as_record(first_choice["delta"]);
      const content = this.read_text(delta["content"]);
      const thinking = this.read_text(delta["reasoning_content"] ?? delta["reasoning"]);
      if (content !== "") {
        response_result += content;
        if (detector.feed(content)) {
          return this.empty_result({ degraded: true });
        }
      }
      if (thinking !== "") {
        response_think += thinking;
      }
      const usage = this.as_record(record["usage"]);
      input_tokens = this.read_number(
        usage["prompt_tokens"] ?? usage["input_tokens"],
        input_tokens,
      );
      output_tokens = this.read_number(
        usage["completion_tokens"] ?? usage["output_tokens"],
        output_tokens,
      );
      const finish_reason = this.read_text(first_choice["finish_reason"]);
      if (finish_reason === "length") {
        error = "供应商返回长度截断。";
      }
      if (finish_reason === "tool_calls") {
        error = "供应商返回工具调用，当前任务不支持。";
      }
    }
    if (LLMClientDegradationDetector.has_output_degradation(response_result)) {
      return this.empty_result({ degraded: true });
    }
    return {
      response_think: response_think.trim(),
      response_result: error === "" ? response_result.trim() : "",
      input_tokens,
      output_tokens,
      cancelled: false,
      timeout: false,
      degraded: false,
      error,
    };
  }

  /**
   * 空结果集中保留完整字段，调用点只覆盖真实请求事实。
   */
  protected empty_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
    return {
      response_think: "",
      response_result: "",
      input_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
      ...overrides,
    };
  }

  /**
   * SDK chunk 是 unknown，读取前统一收窄为普通对象。
   */
  protected as_record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /**
   * 非字符串字段不参与拼接，避免对象误进响应正文。
   */
  protected read_text(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * usage 数字缺失时沿用当前累计值。
   */
  protected read_number(value: unknown, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }
}
