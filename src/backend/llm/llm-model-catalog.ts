import { GoogleGenAI, type Model as GoogleSdkModel } from "@google/genai";

import { read_json_record, type JsonRecord, type JsonValue } from "../../domain/json";
import { Model, type ModelApiFormat } from "../../domain/model";
import * as AppErrors from "../../shared/error";
import { LLMClientPolicy } from "./llm-client-policy";

// 模型列表探测沿用浏览器 UA，减少部分服务商对 Node 默认 UA 的拒绝概率。
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

/**
 * 按供应商协议查询远端实时模型列表；任务级 Key 轮换不参与模型列表探测。
 */
export async function list_available_models(model: JsonRecord): Promise<string[]> {
  try {
    const api_format = resolve_model_api_format(model);
    if (api_format === "Google") {
      return await fetch_google_available_models(model);
    }
    if (api_format === "Anthropic") {
      return await fetch_anthropic_available_models(model);
    }
    return await fetch_openai_available_models(model, api_format);
  } catch (error) {
    throw new AppErrors.ModelProviderFailedError({ cause: error });
  }
}

/**
 * OpenAI-compatible 与 Sakura 都复用 `/models` 列表语义。
 */
async function fetch_openai_available_models(
  model: JsonRecord,
  api_format: ModelApiFormat,
): Promise<string[]> {
  const api_url = LLMClientPolicy.normalize_api_url(String(model["api_url"] ?? ""), api_format);
  const data = await fetch_json(`${api_url}/models`, {
    Authorization: `Bearer ${LLMClientPolicy.get_primary_api_key(String(model["api_key"] ?? ""))}`,
    ...build_browser_headers(model),
  });
  return read_response_model_ids(data, "data", "id");
}

/**
 * Google 模型列表走 @google/genai，让 SDK 统一拼接 apiVersion 与 list 路径。
 */
async function fetch_google_available_models(model: JsonRecord): Promise<string[]> {
  const api_url = LLMClientPolicy.normalize_api_url(String(model["api_url"] ?? ""), "Google");
  const client = new GoogleGenAI({
    apiKey: LLMClientPolicy.get_primary_api_key(String(model["api_key"] ?? "")),
    httpOptions: {
      baseUrl: api_url === "" ? undefined : api_url,
      headers: build_browser_headers(model),
    },
  } as ConstructorParameters<typeof GoogleGenAI>[0]);
  return await read_google_model_names(await client.models.list());
}

/**
 * Anthropic models.list 使用 `/v1/models` 与 x-api-key header。
 */
async function fetch_anthropic_available_models(model: JsonRecord): Promise<string[]> {
  const api_url = LLMClientPolicy.normalize_api_url(String(model["api_url"] ?? ""), "Anthropic");
  const base_url = api_url === "" ? "https://api.anthropic.com" : api_url;
  const data = await fetch_json(`${base_url}/v1/models`, {
    "anthropic-version": "2023-06-01",
    "x-api-key": LLMClientPolicy.get_primary_api_key(String(model["api_key"] ?? "")),
    ...build_browser_headers(model),
  });
  return read_response_model_ids(data, "data", "id");
}

/**
 * fetch 只负责 HTTP 细节，模型列表字段解释留在调用点。
 */
async function fetch_json(url: string, headers: Record<string, string>): Promise<JsonValue> {
  const response = await fetch(url, { headers, method: "GET" });
  if (!response.ok) {
    throw new AppErrors.ModelProviderFailedError({
      public_details: { status: response.status },
      cause: response,
    });
  }
  return (await response.json()) as JsonValue;
}

/**
 * 读取 HTTP 模型列表数组结构，坏项直接跳过。
 */
function read_response_model_ids(data: JsonValue, array_key: string, id_key: string): string[] {
  const record = { ...read_json_record(data) };
  const items = record[array_key];
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => ({ ...read_json_record(item) })[id_key])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

/**
 * Google SDK pager 会自动跨页，模型名缺失的条目不进入页面候选列表。
 */
async function read_google_model_names(pager: AsyncIterable<GoogleSdkModel>): Promise<string[]> {
  const names: string[] = [];
  for await (const item of pager) {
    if (typeof item.name === "string" && item.name.trim() !== "") {
      names.push(item.name);
    }
  }
  return names;
}

/**
 * 模型列表沿用浏览器 UA，并合并用户自定义额外 header。
 */
function build_browser_headers(model: JsonRecord): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": BROWSER_USER_AGENT };
  const request_config = { ...read_json_record(model["request"]) };
  if (request_config["extra_headers_custom_enable"] !== true) {
    return headers;
  }
  const extra_headers = { ...read_json_record(request_config["extra_headers"]) };
  for (const [key, value] of Object.entries(extra_headers)) {
    headers[key] = String(value);
  }
  return headers;
}

/**
 * API 格式缺失时按 OpenAI-compatible 处理。
 */
function resolve_model_api_format(model: JsonRecord): ModelApiFormat {
  return Model.normalize_api_format(String(model["api_format"] ?? "OpenAI"));
}
