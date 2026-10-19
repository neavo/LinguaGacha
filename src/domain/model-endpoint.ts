import type { ModelApiFormat } from "./model";

/** 各协议的地址规则抄自对应 SDK，升级 SDK 时按行尾注释的来源核对。 */
type ModelEndpoint = Readonly<{
  default_base_url: string; // 用户地址为空时 SDK 实际使用的根地址
  endpoint_suffix_pattern?: RegExp; // SDK 会自行追加的末尾路径，用户填入时去掉
  request_path: string; // SDK 在根地址后追加的生成端点
}>;

// OpenAI 系协议共用根地址规则，只有生成端点不同。
const OPENAI_ENDPOINT = Object.freeze({
  default_base_url: "https://api.openai.com/v1", // `openai/client.mjs`
  endpoint_suffix_pattern: /\/(?:chat\/completions|responses)$/iu,
  request_path: "/chat/completions", // `openai/resources/chat/completions/completions.mjs`
});
const MODEL_ENDPOINTS: Readonly<Record<ModelApiFormat, ModelEndpoint>> = Object.freeze({
  OpenAI: OPENAI_ENDPOINT,
  SakuraLLM: OPENAI_ENDPOINT,
  OpenAIResponses: Object.freeze({
    ...OPENAI_ENDPOINT,
    request_path: "/responses", // `openai/resources/responses/responses.mjs`
  }),
  Anthropic: Object.freeze({
    default_base_url: "https://api.anthropic.com", // `@anthropic-ai/sdk/client.mjs`
    endpoint_suffix_pattern: /\/v1(?:\/messages)?$/iu,
    request_path: "/v1/messages", // `@anthropic-ai/sdk/resources/messages/messages.mjs`
  }),
  Google: Object.freeze({
    default_base_url: "https://generativelanguage.googleapis.com/v1beta", // `@google/genai/dist/node/index.mjs`
    request_path: "/{model}:streamGenerateContent?alt=sse", // 同文件的 `generateContentStreamInternal`
  }),
});
const GOOGLE_API_VERSION_SEGMENT_PATTERN = /\/v1(?:beta|alpha)?$/iu; // 用户显式填写的版本段原样保留
const GOOGLE_DEFAULT_API_VERSION = "/v1beta"; // Pi 关闭 SDK 版本拼接，缺省版本由这里补齐

/** 用户地址转为 SDK 根地址；显式默认值让请求、列表、能力匹配和预览共用同一去向。 */
export function resolve_model_base_url(api_url: string, api_format: ModelApiFormat): string {
  const endpoint = MODEL_ENDPOINTS[api_format];
  const normalized = api_url.trim().replace(/\/+$/u, "");
  if (normalized === "") return endpoint.default_base_url;
  if (api_format === "Google") {
    return GOOGLE_API_VERSION_SEGMENT_PATTERN.test(normalized)
      ? normalized
      : `${normalized}${GOOGLE_DEFAULT_API_VERSION}`;
  }
  return endpoint.endpoint_suffix_pattern === undefined
    ? normalized
    : normalized.replace(endpoint.endpoint_suffix_pattern, "");
}

/** 预览 SDK 追加生成端点后的请求地址；Google 模型前缀遵循 `@google/genai` 的 `tModel`。 */
export function build_model_request_url(
  api_url: string,
  api_format: ModelApiFormat,
  model_id: string,
): string {
  const base_url = resolve_model_base_url(api_url, api_format);
  // 只有 Google 端点含 `{model}` 占位，其他协议的替换不生效。
  const model =
    model_id.startsWith("models/") || model_id.startsWith("tunedModels/")
      ? model_id
      : `models/${model_id}`;
  return `${base_url}${MODEL_ENDPOINTS[api_format].request_path.replace("{model}", model)}`;
}
