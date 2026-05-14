import Anthropic from "@anthropic-ai/sdk";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
import type {
  ProviderClientPoolRequest,
  ProviderClientResolver,
  RequestTransport,
} from "./transport-types";

/**
 * Anthropic client 使用 x-api-key SDK 配置，不把凭据放进 payload。
 */
export function create_anthropic_client(request: ProviderClientPoolRequest): Anthropic {
  return new Anthropic({
    apiKey: request.api_key,
    baseURL: request.base_url === "" ? undefined : request.base_url,
    defaultHeaders: request.headers,
    maxRetries: 0,
    timeout: request.timeout_ms,
  });
}

/**
 * AnthropicTransport 通过 @anthropic-ai/sdk messages stream 发送请求，并归一 text/thinking/usage。
 */
export class AnthropicTransport implements RequestTransport {
  /**
   * pool 是 @anthropic-ai/sdk client 的唯一来源。
   */
  public constructor(private readonly pool: ProviderClientResolver) {}

  public async send(policy: ResolvedRequestPolicy, signal: AbortSignal): Promise<LLMRequestResult> {
    const client = this.pool.get_client<{ messages: { create: Function } }>({
      provider: policy.provider,
      api_format: policy.api_format,
      base_url: policy.base_url,
      api_key: policy.api_keys[0] ?? "no_key_required",
      timeout_ms: policy.timeout_ms,
      headers: policy.headers,
    });
    const stream = await client.messages.create(policy.payload, { signal });
    const detector = new LLMClientDegradationDetector();
    let response_result = "";
    let response_think = "";
    let input_tokens = 0;
    let output_tokens = 0;
    let error = "";
    for await (const event of stream as AsyncIterable<unknown>) {
      const record = this.as_record(event);
      if (record["type"] === "content_block_delta") {
        const delta = this.as_record(record["delta"]);
        const text = this.read_text(delta["text"]);
        const thinking = this.read_text(delta["thinking"]);
        if (text !== "") {
          response_result += text;
          if (detector.feed(text)) {
            return this.empty_result({ degraded: true });
          }
        }
        if (thinking !== "") {
          response_think += thinking;
        }
      }
      const message = this.as_record(record["message"]);
      const usage = this.as_record(message["usage"] ?? record["usage"]);
      input_tokens = this.read_number(usage["input_tokens"], input_tokens);
      output_tokens = this.read_number(usage["output_tokens"], output_tokens);
      const stop_reason = this.read_text(message["stop_reason"] ?? record["stop_reason"]);
      if (stop_reason === "max_tokens") {
        error = "供应商返回长度截断。";
      }
      if (stop_reason === "tool_use") {
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
  private empty_result(overrides: Partial<LLMRequestResult> = {}): LLMRequestResult {
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
   * SDK event 在读取前统一收窄为普通对象。
   */
  private as_record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /**
   * 只拼接字符串文本，避免对象误入日志。
   */
  private read_text(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * usage 缺失时保留已有累计值。
   */
  private read_number(value: unknown, fallback: number): number {
    const number_value = Number(value ?? fallback);
    return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
  }
}
