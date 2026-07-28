import Anthropic from "@anthropic-ai/sdk";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
import { read_json_integer } from "../../../domain/json";
import { log_error_from_message, type LogError } from "../../../shared/error";
import type {
  ProviderClientPoolRequest,
  ProviderClientResolver,
  RequestTransport,
} from "./transport-types";
import { empty_llm_result, read_transport_record, read_transport_text } from "./transport-types";

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
    let request_error: LogError | undefined;
    for await (const event of stream as AsyncIterable<unknown>) {
      const record = read_transport_record(event);
      if (record["type"] === "content_block_delta") {
        const delta = read_transport_record(record["delta"]);
        const text = read_transport_text(delta["text"]);
        const thinking = read_transport_text(delta["thinking"]);
        if (text !== "") {
          response_result += text;
          if (detector.feed(text)) {
            return empty_llm_result({ degraded: true });
          }
        }
        if (thinking !== "") {
          response_think += thinking;
        }
      }
      const message = read_transport_record(record["message"]);
      const usage = read_transport_record(message["usage"] ?? record["usage"]);
      input_tokens = read_json_integer(usage["input_tokens"], input_tokens);
      output_tokens = read_json_integer(usage["output_tokens"], output_tokens);
      const stop_reason = read_transport_text(message["stop_reason"] ?? record["stop_reason"]);
      if (stop_reason === "max_tokens") {
        request_error = log_error_from_message("供应商返回长度截断。", { stop_reason });
      }
      if (stop_reason === "tool_use") {
        request_error = log_error_from_message("供应商返回工具调用，当前任务不支持。", {
          stop_reason,
        });
      }
    }
    if (LLMClientDegradationDetector.has_output_degradation(response_result)) {
      return empty_llm_result({ degraded: true });
    }
    return {
      response_think: response_think.trim(),
      response_result: request_error === undefined ? response_result.trim() : "",
      input_tokens,
      output_tokens,
      cancelled: false,
      timeout: false,
      degraded: false,
      ...(request_error === undefined ? {} : { request_error }),
    };
  }
}
