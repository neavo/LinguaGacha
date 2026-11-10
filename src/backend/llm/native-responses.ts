import {
  is_json_record,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../domain/json";
import { DEFAULT_MODEL_AGENT_CONFIG } from "../../domain/model-agent";
import { log_error_from_message, to_log_error } from "../../shared/error";
import {
  read_model_request_snapshot,
  read_request_timeout_ms,
  resolve_one_shot_generation_options,
} from "./llm-request";
import { resolve_model_capability } from "./model-capability";
import { resolve_pi_model } from "./llm-pi";
import { apply_request_overrides } from "./llm-payload";
import type { PiModelCatalogReader } from "./pi-model-catalog";
import type { LLMRequestFacts } from "./llm-types";
import { create_provider_error } from "../network/provider-error";
import { record_http_response_info, with_http_response_info } from "../network/http-response-info";

export const NATIVE_REQUEST_MAX_BYTES = 64_000_000;
export const RESPONSES_CONFIG_FIELDS = [
  "model",
  "temperature",
  "top_p",
  "max_output_tokens",
  "max_tokens",
  "reasoning",
  "reasoning_effort",
  "service_tier",
] as const;
export type NativeResponsesResult = LLMRequestFacts & {
  response: JsonRecord | null;
  usage_complete: boolean;
  item_failure: boolean;
};
export type NativeResponsesInput = {
  payload: JsonRecord;
  model: JsonValue;
  config_snapshot: JsonValue;
  run_id: string;
};
/** 原生载荷保留供应商输出，传输仍消费同一模型快照、代理和错误事实。 */
export class NativeResponsesClient {
  /** 复用应用网络入口，并从共享目录读取模型能力。 */
  public constructor(
    private readonly user_agent: string,
    private readonly catalog: PiModelCatalogReader,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  /** 在单次请求上下文内采集 HTTP 事实。 */
  public request(input: NativeResponsesInput, signal: AbortSignal): Promise<NativeResponsesResult> {
    return with_http_response_info(() => this.execute(input, signal));
  }
  /** 合并保存配置，等待原生响应并保留失败证据。 */
  private async execute(
    input: NativeResponsesInput,
    signal: AbortSignal,
  ): Promise<NativeResponsesResult> {
    const snapshot = read_model_request_snapshot(input.model, {
      user_agent: this.user_agent,
      session_id: input.run_id,
    });
    if (snapshot.auth_type !== "api_key" || snapshot.api_format !== "OpenAIResponses")
      throw new Error("Native Responses requires an API Key OpenAIResponses configuration.");
    const base: NativeResponsesResult = {
      response: null,
      input_tokens: 0,
      reasoning_tokens: 0,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      usage_complete: false,
      item_failure: false,
    };
    if (typeof input.payload["input"] !== "string" && !Array.isArray(input.payload["input"]))
      return {
        ...base,
        item_failure: true,
        response_error: log_error_from_message("Responses input must be a string or array."),
      };
    const conflicts = RESPONSES_CONFIG_FIELDS.filter((field) =>
      Object.hasOwn(input.payload, field),
    );
    if (conflicts.length > 0)
      return {
        ...base,
        item_failure: true,
        response_error: log_error_from_message(
          `Move controlled fields to model settings: ${conflicts.join(", ")}`,
        ),
      };
    if (
      (input.payload["stream"] !== undefined && input.payload["stream"] !== false) ||
      (input.payload["background"] !== undefined && input.payload["background"] !== false)
    )
      return {
        ...base,
        item_failure: true,
        response_error: log_error_from_message(
          "Streaming and background requests are not supported.",
        ),
      };
    const timeout = AbortSignal.timeout(read_request_timeout_ms(input.config_snapshot));
    const combined = AbortSignal.any([signal, timeout]);
    const secrets = [...snapshot.api_keys, ...Object.values(snapshot.headers)].filter(
      (value) => value.length > 0,
    );
    const redact = (value: string) =>
      secrets.reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), value);
    try {
      const capability = resolve_model_capability(
        {
          api_format: snapshot.api_format,
          api_url: snapshot.endpoint.base_url,
          model_id: snapshot.model_id,
          agent: DEFAULT_MODEL_AGENT_CONFIG,
        },
        this.catalog.read_models(),
      );
      const resolved = resolve_pi_model(snapshot, capability, {
        name: snapshot.model_id,
        input: ["text"],
      });
      const generation = resolve_one_shot_generation_options(snapshot);
      const payload: Record<string, unknown> = {
        ...input.payload,
        model: snapshot.endpoint.model_id,
        stream: false,
        store: false,
        input:
          typeof input.payload["input"] === "string"
            ? [{ role: "user", content: input.payload["input"] }]
            : input.payload["input"],
        ...(generation.temperature === undefined ? {} : { temperature: generation.temperature }),
        ...(generation.maxTokens === undefined ? {} : { max_output_tokens: generation.maxTokens }),
        ...generation.samplingParams,
      };
      if (
        resolved.model.reasoning &&
        snapshot.thinking_level !== "DEFAULT" &&
        !(resolved.thinkingLevel === "off" && resolved.model.thinkingLevelMap?.off === null)
      ) {
        const effort =
          resolved.model.thinkingLevelMap?.[resolved.thinkingLevel] ??
          (resolved.thinkingLevel === "off" ? "none" : resolved.thinkingLevel);
        payload["reasoning"] = { effort };
      }
      const final = apply_request_overrides(snapshot, payload, {
        compat: resolved.model.compat,
        request: capability.request,
        one_shot_signal: combined,
      });
      if (
        (final["stream"] !== undefined && final["stream"] !== false) ||
        (final["background"] !== undefined && final["background"] !== false)
      )
        throw new Error("Streaming and background requests are not supported.");
      const body = JSON.stringify(final);
      if (Buffer.byteLength(body) > NATIVE_REQUEST_MAX_BYTES)
        return {
          ...base,
          item_failure: true,
          response_error: log_error_from_message("Request exceeds 64 MB."),
        };
      const headers = new Headers(snapshot.headers);
      if (["authorization", "host"].some((name) => headers.has(name)))
        throw new Error("Authentication and target headers must use model settings.");
      headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${snapshot.api_keys[0]}`);
      const response = await this.fetcher(snapshot.endpoint.base_url + "/responses", {
        method: "POST",
        redirect: "error",
        headers,
        body,
        signal: combined,
      });
      record_http_response_info(response);
      const text = await response.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        raw = null;
      }
      const record = is_json_record(raw) ? raw : null;
      const safe_record = record === null ? null : (redact_response(record, redact) as JsonRecord); // 先用原始字段归一状态，再发布脱敏证据。
      if (!response.ok) {
        const detail = read_json_record(record?.["error"]);
        const account =
          response.status === 401 ||
          response.status === 403 ||
          [
            "insufficient_quota",
            "billing_hard_limit_reached",
            "subscription_sharing_usage_limit_exceeded",
          ].includes(String(detail["code"]));
        const item_failure =
          !account &&
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status);
        return {
          ...base,
          response: safe_record,
          item_failure,
          retryable: !account && !item_failure,
          request_error: to_log_error(
            create_provider_error(safe_record ?? redact(text), response.status),
          ),
        };
      }
      if (record === null)
        return {
          ...base,
          item_failure: true,
          response_error: log_error_from_message("Responses returned invalid JSON."),
        };
      const usage = read_json_record(record["usage"]);
      const tokens = (value: unknown) =>
        typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
      const output = tokens(usage["output_tokens"]);
      const reasoning = Math.min(
        output,
        tokens(read_json_record(usage["output_tokens_details"])["reasoning_tokens"]),
      );
      const refused =
        Array.isArray(record["output"]) &&
        record["output"].some(
          (item) =>
            is_json_record(item) &&
            Array.isArray(item["content"]) &&
            item["content"].some(
              (content) => is_json_record(content) && content["type"] === "refusal",
            ),
        );
      const failed = record["status"] !== "completed" || refused || record["error"] != null;
      return {
        ...base,
        response: safe_record,
        input_tokens: tokens(usage["input_tokens"]),
        output_tokens: output - reasoning,
        reasoning_tokens: reasoning,
        usage_complete:
          typeof usage["input_tokens"] === "number" && typeof usage["output_tokens"] === "number",
        item_failure: failed,
        ...(failed
          ? {
              response_error: log_error_from_message(
                `Responses did not complete successfully: ${String(record["status"])}`,
              ),
            }
          : {}),
      };
    } catch (error) {
      if (signal.aborted) return { ...base, cancelled: true };
      if (timeout.aborted) return { ...base, timeout: true };
      // 本地载荷与配置错误不进入无限网络恢复。原始异常可能含凭据，工具只接收脱敏消息。
      if (!(error instanceof TypeError))
        throw new Error(redact(error instanceof Error ? error.message : "Responses failed."));
      return { ...base, request_error: log_error_from_message(redact(error.message)) };
    }
  }
}

/** 先解析再脱敏，避免 JSON 转义使凭据漏出或字符串替换破坏响应结构。 */
function redact_response(value: JsonValue, redact: (text: string) => string): JsonValue {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((entry) => redact_response(entry, redact));
  if (is_json_record(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [redact(key), redact_response(entry, redact)]),
    );
  return value;
}
