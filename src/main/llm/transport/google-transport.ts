import { GoogleGenAI } from "@google/genai";

import type { ResolvedRequestPolicy } from "../policy/policy-types";
import type { LLMRequestResult } from "../llm-types";
import { LLMClientDegradationDetector } from "../llm-client-degradation-detector";
import type {
  ProviderClientPoolRequest,
  ProviderClientResolver,
  RequestTransport,
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
      const record = this.as_record(chunk);
      const text = this.read_text(record["text"]);
      if (text !== "") {
        response_result += text;
        if (detector.feed(text)) {
          return this.empty_result({ degraded: true });
        }
      }
      for (const part of this.read_parts(record)) {
        const part_text = this.read_text(part["text"]);
        if (part["thought"] === true) {
          response_think += part_text;
        } else if (part_text !== "" && text === "") {
          response_result += part_text;
        }
      }
      const usage = this.as_record(record["usageMetadata"]);
      input_tokens = this.read_number(usage["promptTokenCount"], input_tokens);
      output_tokens = this.read_number(usage["candidatesTokenCount"], output_tokens);
    }
    if (LLMClientDegradationDetector.has_output_degradation(response_result)) {
      return this.empty_result({ degraded: true });
    }
    return {
      response_think: response_think.trim(),
      response_result: response_result.trim(),
      input_tokens,
      output_tokens,
      cancelled: false,
      timeout: false,
      degraded: false,
      error: "",
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
        ...this.as_record(policy.payload["config"]),
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
      const content = this.as_record(this.as_record(candidate)["content"]);
      const parts = content["parts"];
      return Array.isArray(parts) ? parts.map((part) => this.as_record(part)) : [];
    });
  }

  /**
   * 空结果保持字段完整，便于 LLMClient 统一返回。
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
   * SDK chunk 在读取前统一收窄为普通对象。
   */
  private as_record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /**
   * 只拼接字符串文本，其他字段按缺省处理。
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
