import type { StreamOptions } from "@earendil-works/pi-ai";

import { Model, type ModelApiFormat, type ModelThinkingLevel } from "../../domain/model";
import {
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../domain/json";
import { normalize_setting_snapshot } from "../../domain/setting";
import { ENDPOINT_REQUEST_OVERRIDES } from "./llm-overrides";

/** 身份由任务或对话拥有，请求准备只读取本次冻结值。 */
export type ModelRequestIdentity = Readonly<{
  user_agent: string;
  session_id: string;
}>;

/** 单次翻译与 Agent 共用的请求快照；模型能力独立解析后交给 Pi 模型构造。 */
export type ModelRequestSnapshot = Readonly<{
  api_format: ModelApiFormat; // 用户选定的请求协议，与目录模板来源独立。
  api_keys: readonly string[]; // 至少保留一个凭据或免密占位值。
  base_url: string;
  model_id: string; // 最终请求保留用户配置的原始模型 ID。
  headers: Readonly<Record<string, string>>;
  extra_body: Readonly<JsonRecord>;
  generation: Readonly<JsonRecord>;
  output_token_limit: number; // `0` 和 `-1` 表示单次输出上限自动。
  thinking_level: ModelThinkingLevel; // 配置写入口确认的产品思考档位。
}>;

const DEFAULT_OUTPUT_TOKEN_LIMIT = 4096; // 缺少旧配置字段时的单次输出上限。
const GOOGLE_DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_API_VERSION_SEGMENT_PATTERN = /\/v1(?:beta|alpha)?$/iu;
const OPENAI_ENDPOINT_SUFFIX_PATTERN = /\/(?:chat\/completions|responses)$/iu;

/** 多行密钥去空白；本地免密接口仍使用 Pi 要求的非空占位值。 */
export function collect_api_keys(raw_api_key: string): string[] {
  const keys = raw_api_key
    .split(/\r?\n/u)
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : ["no_key_required"];
}

/** 模型列表只读取首个凭据，密钥轮换由翻译调度器负责。 */
export function get_primary_api_key(raw_api_key: string): string {
  return collect_api_keys(raw_api_key)[0] ?? "no_key_required";
}

/** OpenAI SDK 自行拼接端点，配置只保留 API 根地址。 */
export function normalize_openai_sdk_base_url(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(OPENAI_ENDPOINT_SUFFIX_PATTERN, "");
}

/** Google adapter 直接消费完整版本路径，保留用户显式版本。 */
export function normalize_google_api_base_url(url: string): string {
  const normalized = url.trim().replace(/\/+$/u, "");
  if (normalized === "") return GOOGLE_DEFAULT_API_BASE_URL;
  return GOOGLE_API_VERSION_SEGMENT_PATTERN.test(normalized) ? normalized : `${normalized}/v1beta`;
}

/** 按选定协议生成适配器需要的请求根地址。 */
export function normalize_pi_api_url(url: string, api_format: ModelApiFormat): string {
  if (api_format === "Google") return normalize_google_api_base_url(url);
  if (api_format === "OpenAI" || api_format === "OpenAIResponses" || api_format === "SakuraLLM") {
    return normalize_openai_sdk_base_url(url);
  }
  return url.trim().replace(/\/+$/u, "");
}

/** JSON 配置只在请求边界收窄，扩展字段仅在用户启用时生效。 */
export function read_model_request_snapshot(
  model: JsonValue,
  identity: ModelRequestIdentity,
): ModelRequestSnapshot {
  const record = read_json_record(model);
  const api_format = Model.normalize_api_format(record["api_format"]);
  const request = read_json_record(record["request"]);
  const threshold = read_json_record(record["threshold"]);
  const thinking = read_json_record(record["thinking"]);
  const base_url = normalize_pi_api_url(String(record["api_url"] ?? ""), api_format);
  return {
    api_format,
    api_keys: collect_api_keys(String(record["api_key"] ?? "")),
    base_url,
    model_id: String(record["model_id"] ?? ""),
    headers: build_request_headers(
      base_url,
      identity,
      read_enabled_record(request, "extra_headers", "extra_headers_custom_enable"),
    ),
    extra_body: read_enabled_record(request, "extra_body", "extra_body_custom_enable"),
    generation: read_json_record(record["generation"]),
    output_token_limit: read_json_integer(
      threshold["output_token_limit"],
      DEFAULT_OUTPUT_TOKEN_LIMIT,
    ),
    thinking_level: Model.normalize_thinking_level(thinking["level"]),
  };
}

/** 请求头大小写不敏感覆盖；Google 对象展开要求保留 `User-Agent` 拼写。 */
export function build_request_headers(
  base_url: string,
  identity: ModelRequestIdentity,
  extra_headers: Readonly<JsonRecord>,
): Record<string, string> {
  const hostname = URL.parse(base_url)?.hostname;
  const endpoint = ENDPOINT_REQUEST_OVERRIDES.find((override) => override.hostname === hostname);
  const headers = Object.fromEntries(
    Object.entries(extra_headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
  const user_agent = headers["user-agent"] ?? identity.user_agent;
  delete headers["user-agent"];
  return {
    "User-Agent": user_agent,
    ...(endpoint === undefined ? {} : { [endpoint.session_header]: identity.session_id }),
    ...headers,
  };
}

/** 将设置中的秒数换算为毫秒，最短请求时限为一秒。 */
export function read_request_timeout_ms(config_snapshot: JsonValue): number {
  return Math.max(
    1_000,
    Math.trunc(normalize_setting_snapshot(config_snapshot).request_timeout * 1_000),
  );
}

/** Pi 正式选项承担通用生成字段；Anthropic / Google 的 `top_p` 在载荷边界处理。 */
export function resolve_one_shot_generation_options(
  snapshot: ModelRequestSnapshot,
): Pick<StreamOptions, "temperature" | "maxTokens" | "samplingParams"> {
  const result: Pick<StreamOptions, "temperature" | "maxTokens" | "samplingParams"> = {};
  const temperature = read_custom_number(snapshot.generation, "temperature");
  if (
    temperature !== null &&
    (snapshot.api_format !== "Anthropic" ||
      snapshot.thinking_level === "OFF" ||
      snapshot.thinking_level === "DEFAULT")
  ) {
    result.temperature = temperature;
  }
  const max_tokens = resolve_max_tokens_for_request(snapshot);
  if (max_tokens !== null) result.maxTokens = max_tokens;
  const top_p = read_custom_number(snapshot.generation, "top_p");
  if (
    top_p !== null &&
    (snapshot.api_format === "OpenAI" ||
      snapshot.api_format === "OpenAIResponses" ||
      snapshot.api_format === "SakuraLLM")
  ) {
    result.samplingParams = { top_p };
  }
  return result;
}

/** 只有显式启用的数值才进入请求，避免 UI 默认值改变供应商默认行为。 */
export function read_custom_number(generation: Readonly<JsonRecord>, key: string): number | null {
  if (generation[`${key}_custom_enable`] !== true) return null;
  const value = Number(generation[key]);
  return Number.isFinite(value) ? value : null;
}

/** 自动上限由调用协议决定；此处只读取用户的显式单次限制。 */
export function resolve_max_tokens_for_request(snapshot: ModelRequestSnapshot): number | null {
  return snapshot.output_token_limit === 0 || snapshot.output_token_limit === -1
    ? null
    : Math.max(1, snapshot.output_token_limit);
}

/** 关闭扩展开关时丢弃已保存内容，避免默认配置进入请求。 */
function read_enabled_record(
  record: JsonRecord,
  value_key: string,
  enabled_key: string,
): JsonRecord {
  return record[enabled_key] === true ? read_json_record(record[value_key]) : {};
}
