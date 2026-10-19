import type { ModelApiFormat } from "./model";

/** 地址规则对应 SDK 的默认值与路径拼接，升级时按行尾来源核对。 */
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
const GOOGLE_API_VERSION_SEGMENT_PATTERN = /\/v1(?:beta|alpha)?\d*$/iu; // 用户显式填写的版本段原样保留
const GOOGLE_DEFAULT_API_VERSION = "/v1beta"; // Pi 关闭 SDK 版本拼接，缺省版本由这里补齐
const VERTEX_HOST_PATTERN = /^[a-z]+(?:-[a-z]+)*\d+-aiplatform\.googleapis\.com$/u;
const VERTEX_PATH_PATTERN =
  /^(?:\/(v1(?:beta\d+)?))?(?:\/(projects\/[^/]+\/locations\/[^/]+))?(?:\/publishers\/google)?$/u;
const VERTEX_MODEL_PATTERN =
  /^(?:(projects\/[^/]+\/locations\/[^/]+)\/)?publishers\/google\/models\/([^/]+)$/u;

/** 配置可暂时处于编辑中的无效状态，调用入口负责阻止发送并反馈错误。 */
export type ResolvedModelEndpoint = Readonly<{
  api: Exclude<ModelApiFormat, "Google"> | "google-generative-ai" | "google-vertex";
  base_url: string; // SDK 根地址包含当前请求作用域。
  model_id: string; // SDK 模型身份不包含 Vertex 项目与区域，避免影响其型号判断。
  error: "vertex_path" | "vertex_model" | "vertex_scope" | null;
}>;

/** Google 官方主机决定接口形态；Vertex 作用域归根地址，模型短名交给 SDK 判断型号。 */
export function resolve_model_endpoint(
  api_url: string,
  api_format: ModelApiFormat,
  model_id: string,
): ResolvedModelEndpoint {
  const normalized = api_url.trim().replace(/\/+$/u, "");
  const url = URL.parse(normalized);
  if (
    api_format === "Google" &&
    url !== null &&
    (url.hostname === "aiplatform.googleapis.com" || VERTEX_HOST_PATTERN.test(url.hostname))
  ) {
    const path = VERTEX_PATH_PATTERN.exec(url.pathname.replace(/\/+$/u, "")); // 分组为版本与项目作用域。
    const resource = VERTEX_MODEL_PATTERN.exec(model_id); // 分组为项目作用域与模型短名。
    const short_id = resource?.[2] ?? model_id.replace(/^models\//u, "");
    const scope = resource?.[1] ?? path?.[2];
    const error =
      path === null || url.search !== "" || url.hash !== ""
        ? "vertex_path"
        : resource?.[1] !== undefined && path[2] !== undefined && resource[1] !== path[2]
          ? "vertex_scope"
          : short_id === "" || /[\s/?:#]/u.test(short_id)
            ? "vertex_model"
            : null;
    return Object.freeze({
      api: "google-vertex",
      base_url: `${url.origin}/${path?.[1] ?? "v1"}${scope === undefined ? "" : `/${scope}`}`,
      model_id: short_id,
      error,
    });
  }
  const endpoint = MODEL_ENDPOINTS[api_format];
  const base_url =
    normalized === ""
      ? endpoint.default_base_url
      : api_format === "Google"
        ? GOOGLE_API_VERSION_SEGMENT_PATTERN.test(normalized)
          ? normalized
          : `${normalized}${GOOGLE_DEFAULT_API_VERSION}`
        : endpoint.endpoint_suffix_pattern === undefined
          ? normalized
          : normalized.replace(endpoint.endpoint_suffix_pattern, "");
  return Object.freeze({
    api: api_format === "Google" ? "google-generative-ai" : api_format,
    base_url,
    model_id,
    error: null,
  });
}

/** 用户地址转为 SDK 根地址；显式默认值让请求、列表、能力匹配和预览共用同一去向。 */
export function resolve_model_base_url(api_url: string, api_format: ModelApiFormat): string {
  return resolve_model_endpoint(api_url, api_format, "").base_url;
}

/** 预览 SDK 追加生成端点后的请求地址；Google 模型前缀遵循 `@google/genai` 的 `tModel`。 */
export function build_model_request_url(
  api_url: string,
  api_format: ModelApiFormat,
  model_id: string,
): string {
  const endpoint = resolve_model_endpoint(api_url, api_format, model_id);
  const request_model =
    endpoint.api === "google-vertex"
      ? `publishers/google/models/${endpoint.model_id}`
      : endpoint.model_id.startsWith("models/") || endpoint.model_id.startsWith("tunedModels/")
        ? endpoint.model_id
        : `models/${endpoint.model_id}`;
  return `${endpoint.base_url}${MODEL_ENDPOINTS[api_format].request_path.replace("{model}", request_model)}`;
}
