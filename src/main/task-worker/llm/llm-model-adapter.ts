import fs from "node:fs";
import path from "node:path";

import type { Api, Model, Provider } from "@earendil-works/pi-ai";

import type { ApiJsonValue } from "../../api/api-types";
import {
  Model as BaseModel,
  type ModelThinkingLevel,
  type ModelApiFormat,
} from "../../../base/model";

const REPO_URL = "https://github.com/neavo/LinguaGacha";
const USER_AGENT_NAME = "LinguaGacha";
const DEFAULT_VERSION = "0.0.0";
const DEFAULT_OUTPUT_TOKEN_LIMIT = 4096;
const OUTPUT_TOKEN_LIMIT_AUTO_VALUES = new Set([0, -1]);

export interface LinguaGachaModelSnapshot {
  api_format: ModelApiFormat;
  api_keys: string[];
  api_url: string;
  extra_body: Record<string, ApiJsonValue>;
  extra_headers: Record<string, string>;
  generation: Record<string, ApiJsonValue>;
  model_id: string;
  output_token_limit: number;
  pi_model: Model<Api>;
  thinking_level: ModelThinkingLevel;
}

/**
 * 把 LinguaGacha 模型快照转换为 pi-ai 能执行的模型对象和本地策略上下文。
 */
export function convert_linguagacha_model_to_pi_ai(
  model: ApiJsonValue,
  app_root: string,
): LinguaGachaModelSnapshot {
  const record = read_record(model);
  const api_format = normalize_api_format(read_string(record["api_format"], "OpenAI"));
  const api_url = normalize_api_url(read_string(record["api_url"], ""), api_format);
  const model_id = read_string(record["model_id"], "");
  const extra_headers = read_extra_headers(record, app_root);
  const extra_body = read_enabled_record(
    record,
    "request",
    "extra_body",
    "extra_body_custom_enable",
  );
  const threshold = read_record(record["threshold"]);
  const output_token_limit = read_number(
    threshold["output_token_limit"],
    DEFAULT_OUTPUT_TOKEN_LIMIT,
  );
  const thinking = read_record(record["thinking"]);
  const thinking_level = normalize_thinking_level(read_string(thinking["level"], "OFF"));

  return {
    api_format,
    api_keys: collect_api_keys(read_string(record["api_key"], "")),
    api_url,
    extra_body,
    extra_headers,
    generation: read_record(record["generation"]),
    model_id,
    output_token_limit,
    pi_model: {
      id: model_id,
      name: read_string(record["name"], model_id),
      api: resolve_pi_api(api_format),
      provider: resolve_pi_provider(api_format),
      baseUrl: api_url,
      reasoning: should_enable_pi_reasoning(model_id, api_format),
      thinkingLevelMap: {},
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: read_number(threshold["input_token_limit"], 512),
      maxTokens: resolve_max_tokens(output_token_limit),
      headers: extra_headers,
      compat: resolve_compat(model_id, api_format),
    } as Model<Api>,
    thinking_level,
  };
}

/**
 * 统一读取应用版本并生成旧版 LinguaGacha User-Agent。
 */
export function build_linguagacha_user_agent(app_root: string): string {
  let version = DEFAULT_VERSION;
  try {
    const version_path = path.join(app_root, "version.txt");
    const raw_version = fs.readFileSync(version_path, "utf8").trim();
    if (raw_version !== "") {
      version = raw_version;
    }
  } catch {
    // version.txt 在部分测试和源码运行场景可能不存在；退回占位版本不影响请求语义。
  }
  return `${USER_AGENT_NAME}/v${version} (${REPO_URL})`;
}

/**
 * 把换行分隔 key 归一为列表，空值沿用旧无密钥占位。
 */
export function collect_api_keys(raw_api_key: string): string[] {
  const keys = raw_api_key
    .split(/\r?\n/u)
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : ["no_key_required"];
}

/**
 * 模型列表查询只取首个 key；任务请求由 pi-ai 客户端按快照 key 列表轮换。
 */
export function get_primary_api_key(raw_api_key: string): string {
  return collect_api_keys(raw_api_key)[0] ?? "no_key_required";
}

/**
 * 判断输出 token 是否由供应商自动决定。
 */
export function is_output_token_limit_auto(value: number): boolean {
  return OUTPUT_TOKEN_LIMIT_AUTO_VALUES.has(value);
}

/**
 * OpenAI-compatible 与 Sakura URL 需要去掉 chat completions 后缀。
 */
export function normalize_api_url(url: string, api_format: ModelApiFormat): string {
  const trimmed = url.trim().replace(/\/+$/u, "");
  if (api_format === "OpenAI" || api_format === "SakuraLLM") {
    return trimmed.replace(/\/chat\/completions$/iu, "");
  }
  return trimmed;
}

/**
 * 额外 header 只在用户显式开启时合并，默认始终带 LinguaGacha UA。
 */
function read_extra_headers(
  model: Record<string, ApiJsonValue>,
  app_root: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": build_linguagacha_user_agent(app_root),
  };
  const extra_headers = read_enabled_record(
    model,
    "request",
    "extra_headers",
    "extra_headers_custom_enable",
  );
  for (const [key, value] of Object.entries(extra_headers)) {
    headers[key] = String(value);
  }
  return headers;
}

/**
 * 读取带 custom_enable 开关的对象字段，关闭时返回空对象保持旧语义。
 */
function read_enabled_record(
  model: Record<string, ApiJsonValue>,
  parent_key: string,
  value_key: string,
  enabled_key: string,
): Record<string, ApiJsonValue> {
  const parent = read_record(model[parent_key]);
  if (parent[enabled_key] !== true) {
    return {};
  }
  return read_record(parent[value_key]);
}

/**
 * 未识别格式按 OpenAI-compatible 兜底，避免旧配置阻断任务启动。
 */
function normalize_api_format(value: string): ModelApiFormat {
  return BaseModel.normalize_api_format(value);
}

/**
 * 思考挡位只允许四档稳定值，坏值在边界处收窄为关闭。
 */
function normalize_thinking_level(value: string): ModelThinkingLevel {
  return BaseModel.normalize_thinking_level(value);
}

/**
 * 将 LinguaGacha 的供应商枚举映射到 pi-ai API 名称。
 */
function resolve_pi_api(api_format: ModelApiFormat): Api {
  if (api_format === "Google") {
    return "google-generative-ai";
  }
  if (api_format === "Anthropic") {
    return "anthropic-messages";
  }
  return "openai-completions";
}

/**
 * provider 用于 pi-ai 选择默认传输实现，与 api 名称分开维护。
 */
function resolve_pi_provider(api_format: ModelApiFormat): Provider {
  if (api_format === "Google") {
    return "google";
  }
  if (api_format === "Anthropic") {
    return "anthropic";
  }
  return "openai";
}

/**
 *旧配置的自动 token 值转为保守默认，防止请求携带 0 或 -1。
 */
function resolve_max_tokens(output_token_limit: number): number {
  if (is_output_token_limit_auto(output_token_limit)) {
    return DEFAULT_OUTPUT_TOKEN_LIMIT;
  }
  return Math.max(1, output_token_limit);
}

/**
 * OpenAI-compatible 模型的思考格式差异集中在 compat，调用方不再散落正则。
 */
function resolve_compat(model_id: string, api_format: ModelApiFormat): Model<Api>["compat"] {
  if (api_format !== "OpenAI" && api_format !== "SakuraLLM") {
    return undefined;
  }
  if (/qwen3\.5/iu.test(model_id)) {
    return { thinkingFormat: "qwen", supportsReasoningEffort: false };
  }
  if (/deepseek|kimi|glm/iu.test(model_id)) {
    return { thinkingFormat: "deepseek", supportsReasoningEffort: false };
  }
  return { supportsUsageInStreaming: true };
}

/**
 * reasoning 标记只表达模型是否可能产出思考内容，具体挡位由 payload patch 决定。
 */
function should_enable_pi_reasoning(model_id: string, api_format: ModelApiFormat): boolean {
  if (BaseModel.api_format_supports_reasoning_by_default(api_format)) {
    return true;
  }
  return /gpt-5|qwen3\.5|doubao-seed-(?:1-6|1-8|2-0)|deepseek|kimi|glm/iu.test(model_id);
}

/**
 * 边界读取对象时复制一份，避免后续 patch 意外改动原始配置快照。
 */
function read_record(value: ApiJsonValue | undefined): Record<string, ApiJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

/**
 * 字符串读取只做类型收窄，默认值由调用点表达业务含义。
 */
function read_string(value: ApiJsonValue | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * 数字读取在边界处取整，避免 token 与窗口字段带入浮点数。
 */
function read_number(value: ApiJsonValue | undefined, fallback: number): number {
  const number_value = Number(value ?? fallback);
  return Number.isFinite(number_value) ? Math.trunc(number_value) : fallback;
}
