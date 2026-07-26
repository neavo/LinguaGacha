import OpenAI from "openai";
import type { Stream } from "openai/streaming";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
import { log_error_from_message, type LogError } from "../../../shared/error";
import type {
  ProviderClientPoolRequest,
  ProviderClientResolver,
  RequestTransport,
} from "./transport-types";
import {
  empty_llm_result,
  read_transport_number,
  read_transport_record,
  read_transport_text,
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

  // send 是跨边界副作用入口，集中处理调用时序和错误载荷组装。
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
    let request_error: LogError | undefined;
    for await (const chunk of stream) {
      const record = read_transport_record(chunk);
      const choices = Array.isArray(record["choices"]) ? record["choices"] : [];
      const first_choice = read_transport_record(choices[0]);
      const delta = read_transport_record(first_choice["delta"]);
      const content = read_transport_text(delta["content"]);
      const thinking = read_transport_text(delta["reasoning_content"] ?? delta["reasoning"]);
      if (content !== "") {
        response_result += content;
        if (detector.feed(content)) {
          return empty_llm_result({ degraded: true });
        }
      }
      if (thinking !== "") {
        response_think += thinking;
      }
      const usage = read_transport_record(record["usage"]);
      input_tokens = read_transport_number(
        usage["prompt_tokens"] ?? usage["input_tokens"],
        input_tokens,
      );
      output_tokens = read_transport_number(
        usage["completion_tokens"] ?? usage["output_tokens"],
        output_tokens,
      );
      const finish_reason = read_transport_text(first_choice["finish_reason"]);
      if (finish_reason === "length") {
        request_error = log_error_from_message("供应商返回长度截断。", { finish_reason });
      }
      if (finish_reason === "tool_calls") {
        request_error = log_error_from_message("供应商返回工具调用，当前任务不支持。", {
          finish_reason,
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
