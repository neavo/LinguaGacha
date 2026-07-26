import { GoogleGenAI } from "@google/genai";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
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
 * Google client 使用同一 apiKey/baseUrl/header/timeout 组合复用。
 */
export function create_google_client(request: ProviderClientPoolRequest): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: request.api_key,
    httpOptions: {
      baseUrl: request.base_url === "" ? undefined : request.base_url,
      headers: request.headers,
      timeout: request.timeout_ms,
    },
  } as ConstructorParameters<typeof GoogleGenAI>[0]);
}

/**
 * GoogleTransport 通过 @google/genai 发送 Gemini stream，并只做响应归一。
 */
export class GoogleTransport implements RequestTransport {
  /**
   * pool 是 @google/genai client 的唯一来源。
   */
  public constructor(private readonly pool: ProviderClientResolver) {}

  // send 是跨边界副作用入口，集中处理调用时序和错误载荷组装。
  public async send(policy: ResolvedRequestPolicy, signal: AbortSignal): Promise<LLMRequestResult> {
    const client = this.pool.get_client<{ models: { generateContentStream: Function } }>({
      provider: policy.provider,
      api_format: policy.api_format,
      base_url: policy.base_url,
      api_key: policy.api_keys[0] ?? "no_key_required",
      timeout_ms: policy.timeout_ms,
      headers: policy.headers,
    });
    const stream = await client.models.generateContentStream(
      this.build_generate_content_payload(policy, signal),
    );
    const detector = new LLMClientDegradationDetector();
    let response_result = "";
    let response_think = "";
    let input_tokens = 0;
    let output_tokens = 0;
    for await (const chunk of stream as AsyncIterable<unknown>) {
      const record = read_transport_record(chunk);
      const text = read_transport_text(record["text"]);
      if (text !== "") {
        response_result += text;
        if (detector.feed(text)) {
          return empty_llm_result({ degraded: true });
        }
      }
      for (const part of this.read_parts(record)) {
        const part_text = read_transport_text(part["text"]);
        if (part["thought"] === true) {
          response_think += part_text;
        } else if (part_text !== "" && text === "") {
          response_result += part_text;
        }
      }
      const usage = read_transport_record(record["usageMetadata"]);
      input_tokens = read_transport_number(usage["promptTokenCount"], input_tokens);
      output_tokens = read_transport_number(usage["candidatesTokenCount"], output_tokens);
    }
    if (LLMClientDegradationDetector.has_output_degradation(response_result)) {
      return empty_llm_result({ degraded: true });
    }
    return {
      response_think: response_think.trim(),
      response_result: response_result.trim(),
      input_tokens,
      output_tokens,
      cancelled: false,
      timeout: false,
      degraded: false,
    };
  }

  /**
   * Google SDK 的单次取消信号属于 GenerateContentConfig，不能作为第二参数传入。
   */
  private build_generate_content_payload(
    policy: ResolvedRequestPolicy,
    signal: AbortSignal,
  ): Record<string, unknown> {
    return {
      ...policy.payload,
      config: {
        ...read_transport_record(policy.payload["config"]),
        abortSignal: signal,
      },
    };
  }

  /**
   * Gemini chunk 的候选 parts 才能区分 thought 与正文。
   */
  private read_parts(record: Record<string, unknown>): Array<Record<string, unknown>> {
    const candidates = Array.isArray(record["candidates"]) ? record["candidates"] : [];
    return candidates.flatMap((candidate) => {
      const content = read_transport_record(read_transport_record(candidate)["content"]);
      const parts = content["parts"];
      return Array.isArray(parts) ? parts.map((part) => read_transport_record(part)) : [];
    });
  }
}
