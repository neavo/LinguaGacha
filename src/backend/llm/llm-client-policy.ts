import { Model, type ModelApiFormat } from "../../domain/model";
import {
  is_json_record,
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../domain/json";
import { normalize_setting_snapshot } from "../../domain/setting";
import * as AppErrors from "../../shared/error";
import {
  apply_anthropic_one_shot_request_overrides,
  apply_anthropic_request_overrides,
  build_anthropic_thinking_payload,
} from "./policy/anthropic-policy";
import {
  apply_google_one_shot_request_overrides,
  apply_google_request_overrides,
  build_google_thinking_config,
  normalize_google_pi_base_url,
} from "./policy/google-policy";
import {
  apply_openai_one_shot_request_overrides,
  apply_openai_request_overrides,
  apply_sakura_one_shot_request_overrides,
  build_openai_thinking_payload,
  normalize_openai_compatible_base_url,
} from "./policy/openai-compatible-policy";
import { read_custom_number, resolve_max_tokens_for_request } from "./policy/policy-shared";
import type { ModelRequestSnapshot, RequestProvider } from "./policy/policy-types";

const DEFAULT_OUTPUT_TOKEN_LIMIT = 4096; // 旧配置缺少 threshold 时保持既有单次输出上限

/** 多行密钥统一去空白；无凭据的本地模型仍获得 Pi 所需的非空占位值。 */
export function collect_api_keys(raw_api_key: string): string[] {
  const keys = raw_api_key
    .split(/\r?\n/u)
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : ["no_key_required"];
}

/** 模型列表探测只使用首个 key，不参与任务级轮换。 */
export function get_primary_api_key(raw_api_key: string): string {
  return collect_api_keys(raw_api_key)[0] ?? "no_key_required";
}

/** 按 pi-ai adapter 的实际 base URL 契约归一模型请求地址。 */
export function normalize_pi_api_url(url: string, api_format: ModelApiFormat): string {
  if (api_format === "Google") {
    return normalize_google_pi_base_url(url);
  }
  if (api_format === "OpenAI" || api_format === "SakuraLLM") {
    return normalize_openai_compatible_base_url(url);
  }
  return url.trim().replace(/\/+$/u, "");
}

/** 从模型 JSON 读取 OneShot 与 Agent 共用的请求事实。 */
export function read_model_request_snapshot(
  model: JsonValue,
  user_agent: string,
): ModelRequestSnapshot {
  const record = read_json_record(model);
  const api_format = Model.normalize_api_format(record["api_format"]);
  const request = read_json_record(record["request"]);
  const threshold = read_json_record(record["threshold"]);
  const thinking = read_json_record(record["thinking"]);
  return {
    provider: resolve_provider(api_format),
    api_format,
    api_keys: collect_api_keys(String(record["api_key"] ?? "")),
    base_url: normalize_pi_api_url(String(record["api_url"] ?? ""), api_format),
    model_id: String(record["model_id"] ?? ""),
    headers: read_extra_headers(request, user_agent),
    extra_body: read_enabled_record(request, "extra_body", "extra_body_custom_enable"),
    generation: read_json_record(record["generation"]),
    output_token_limit: read_json_integer(
      threshold["output_token_limit"],
      DEFAULT_OUTPUT_TOKEN_LIMIT,
    ),
    thinking_level: Model.normalize_thinking_level(thinking["level"]),
  };
}

/** 请求超时来自单次调用携带的设置快照。 */
export function read_request_timeout_ms(config_snapshot: JsonValue): number {
  const seconds = normalize_setting_snapshot(config_snapshot).request_timeout;
  return Math.max(1_000, Math.trunc(seconds * 1_000));
}

/** OneShot 通过 Pi stream options 传递通用温度和输出上限。 */
export function resolve_one_shot_generation_options(snapshot: ModelRequestSnapshot): {
  temperature?: number;
  maxTokens?: number;
} {
  const result: { temperature?: number; maxTokens?: number } = {};
  const temperature = read_custom_number(snapshot.generation, "temperature");
  if (
    temperature !== null &&
    (snapshot.provider !== "anthropic" || snapshot.thinking_level === "OFF")
  ) {
    result.temperature = temperature;
  }
  const max_tokens = resolve_max_tokens_for_request(snapshot, {
    auto_value: snapshot.provider === "anthropic" ? 8192 : null,
  });
  if (max_tokens !== null) {
    result.maxTokens = max_tokens;
  }
  return result;
}

/** Pi OneShot payload 只在最后应用 LinguaGacha 的生成、思考和扩展字段。 */
export function apply_one_shot_request_overrides(
  snapshot: ModelRequestSnapshot,
  payload: unknown,
  signal: AbortSignal,
): Record<string, unknown> {
  const record = read_pi_payload(payload, snapshot.provider);
  if (snapshot.provider === "google") {
    const config = record["config"];
    if (!is_json_record(config)) {
      throw invalid_pi_payload(snapshot.provider, "config");
    }
    return {
      ...record,
      config: apply_google_one_shot_request_overrides(config, snapshot, signal),
    };
  }
  if (snapshot.provider === "anthropic") {
    return apply_anthropic_one_shot_request_overrides(record, snapshot);
  }
  if (snapshot.provider === "sakura") {
    return apply_sakura_one_shot_request_overrides(record, snapshot);
  }
  return apply_openai_one_shot_request_overrides(record, snapshot);
}

/** Agent 沿用当前只覆盖思考和 extra_body 的策略，不消费 OneShot 生成参数。 */
export function apply_agent_request_overrides(
  snapshot: ModelRequestSnapshot,
  payload: unknown,
): Record<string, unknown> {
  const record = read_pi_payload(payload, snapshot.provider);
  if (snapshot.provider === "google") {
    const config = record["config"];
    if (!is_json_record(config)) {
      throw invalid_pi_payload(snapshot.provider, "config");
    }
    return { ...record, config: apply_google_request_overrides(config, snapshot) };
  }
  if (snapshot.provider === "anthropic") {
    return apply_anthropic_request_overrides(record, snapshot);
  }
  if (snapshot.provider === "sakura") {
    return Object.assign({ ...record }, snapshot.extra_body);
  }
  return apply_openai_request_overrides(record, snapshot);
}

/** `reasoning` 表示模型族能力，不由当前 OFF/LOW/HIGH 挡位推断。 */
export function supports_thinking(snapshot: ModelRequestSnapshot): boolean {
  if (snapshot.provider === "google") {
    return build_google_thinking_config(snapshot) !== null;
  }
  if (snapshot.provider === "anthropic") {
    return build_anthropic_thinking_payload(snapshot) !== null;
  }
  if (snapshot.provider === "sakura") {
    return false;
  }
  return build_openai_thinking_payload(snapshot.model_id, snapshot.thinking_level) !== null;
}

/** 产品 API 格式只在这里映射为结果归一与覆盖规则使用的 provider 身份。 */
function resolve_provider(api_format: ModelApiFormat): RequestProvider {
  if (api_format === "Google") return "google";
  if (api_format === "Anthropic") return "anthropic";
  if (api_format === "SakuraLLM") return "sakura";
  return "openai-compatible";
}

/** 自定义 header 只有显式启用才覆盖默认 User-Agent。 */
function read_extra_headers(request: JsonRecord, user_agent: string): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": user_agent };
  const extra_headers = read_enabled_record(
    request,
    "extra_headers",
    "extra_headers_custom_enable",
  );
  for (const [key, value] of Object.entries(extra_headers)) {
    headers[key] = String(value);
  }
  return headers;
}

/** 读取带启用开关的 JSON 对象，关闭时不泄漏 UI 默认值。 */
function read_enabled_record(
  record: JsonRecord,
  value_key: string,
  enabled_key: string,
): JsonRecord {
  return record[enabled_key] === true ? read_json_record(record[value_key]) : {};
}

/** onPayload 属于 SDK 边界；坏结构是适配器契约破坏而非用户输入错误。 */
function read_pi_payload(payload: unknown, provider: RequestProvider): Record<string, unknown> {
  if (!is_json_record(payload)) {
    throw invalid_pi_payload(provider);
  }
  return payload;
}

/** 统一构造 Pi payload 结构异常，保留 provider 与可选字段定位。 */
function invalid_pi_payload(
  provider: RequestProvider,
  field?: string,
): AppErrors.InternalInvariantError {
  return new AppErrors.InternalInvariantError({
    diagnostic_context: {
      reason: "invalid_provider_request_payload",
      provider,
      ...(field === undefined ? {} : { field }),
    },
  });
}
