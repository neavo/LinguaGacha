import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { default_native_fs } from "../../../native/native-fs";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import { resolve_model_endpoint } from "../../../domain/model-endpoint";
import { read_config_model_records } from "../../model/model-config-resolver";
import { get_primary_api_key } from "../../llm/llm-request";
import { create_schema_renderer } from "../workspace/schema-description";
import type { AgentWorkspaceRequestChannel } from "../workspace/runtime/request-channel";

const REQUEST_MAX_BYTES = 64_000_000; // 工作区宿主的单次请求体内存边界。
const INPUT_SCHEMA = Type.Object(
  {
    config_id: Type.String({ minLength: 1 }),
    api: Type.Literal("responses"),
    body_file: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const REQUEST_SCHEMA = Type.Object(
  { kind: Type.Literal("request_llm"), ...INPUT_SCHEMA.properties },
  { additionalProperties: false },
);
export type WorkspaceLLMRequest = Static<typeof REQUEST_SCHEMA>;
export type WorkspaceLLMPort = (
  request: WorkspaceLLMRequest,
  signal: AbortSignal,
) => Promise<string>;

/** 参数说明与跨进程校验共用 Schema。 */
export function describe_request_llm(): string {
  return [
    "/** 发送一次原生 Responses 请求，不重试。",
    " * config_id 选择已保存配置。宿主只采用地址和首个 API Key，并在本次 workspace_run 内固定。",
    " * body_file 接受工作区相对路径或本机绝对路径。文件必须是包含 model 的 JSON 对象，大小不超过 64 MB。",
    " * 请求体提供模型、输入和生成参数。不合并配置中的生成参数、额外请求体或请求头。",
    " * 返回脱敏的原始响应文本。调用方检查状态与输出。",
    " * 支持 API Key 认证的非流式请求。后台请求不可用。停止或超时取消请求。 */",
    `requestLLM(input: ${create_schema_renderer(new Map()).render(INPUT_SCHEMA)}): Promise<string>;`,
  ].join("\n");
}

/** 大请求体通过文件读取，IPC 只传递路径和配置身份。 */
export function bind_request_llm(channel: Pick<AgentWorkspaceRequestChannel, "call">) {
  return async (input: Static<typeof INPUT_SCHEMA>): Promise<string> => {
    const result = await channel.call({ ...input, kind: "request_llm" });
    if (typeof result !== "string") throw new Error("Invalid LLM response.");
    return result;
  };
}

/** 宿主校验跨进程参数后借用当前执行的取消信号。 */
export async function execute_llm_request(
  request: unknown,
  signal: AbortSignal,
  port: WorkspaceLLMPort | undefined,
): Promise<string> {
  signal.throwIfAborted();
  if (!Check(REQUEST_SCHEMA, request)) throw new Error("Invalid workspace LLM request.");
  if (!port) throw new Error("LLM requests unavailable.");
  return port(request, signal);
}

/** 每次工作区执行创建一次。后续设置修改由下一次执行采用。 */
export function create_llm_requester(
  config: JsonRecord,
  fetcher: typeof fetch = fetch,
): WorkspaceLLMPort {
  const models = read_config_model_records(config); // 浅拷贝足以固定本入口消费的配置标量。
  return async (request, signal) => {
    signal.throwIfAborted();
    const model = models.find((entry) => entry["id"] === request.config_id);
    if (
      !model ||
      typeof model["api_key"] !== "string" ||
      !model["api_key"].trim() ||
      typeof model["api_url"] !== "string" ||
      !model["api_url"].trim()
    )
      throw new Error("Configure the selected model's address and API key first.");
    if (model["auth_type"] === "oauth")
      throw new Error("LLM requests require API Key authentication.");
    const key = get_primary_api_key(model["api_key"]);
    try {
      const info = default_native_fs.stat(request.body_file);
      if (!info.isFile() || info.size > REQUEST_MAX_BYTES)
        throw new Error("LLM request body must be a JSON file no larger than 64 MB.");
      const body = default_native_fs.read_file(request.body_file);
      // 文件可能在 stat 后增长，读取后再次核对实际字节数。
      if (body.byteLength > REQUEST_MAX_BYTES) throw new Error("LLM request body exceeds 64 MB.");
      const text = body.toString("utf8");
      const payload: unknown = JSON.parse(text);
      if (
        !is_json_record(payload) ||
        typeof payload["model"] !== "string" ||
        !payload["model"].trim()
      )
        throw new Error("LLM request body must be a JSON object with a model.");
      // 流式及后台任务需要独立的生命周期契约。当前入口等待一次完整响应。
      if (
        (payload["stream"] !== undefined && payload["stream"] !== false) ||
        (payload["background"] !== undefined && payload["background"] !== false)
      )
        throw new Error("Streaming and background LLM requests are not supported.");
      const endpoint = resolve_model_endpoint(
        model["api_url"],
        "OpenAIResponses",
        payload["model"],
      );
      const response = await fetcher(endpoint.base_url + "/responses", {
        method: "POST",
        redirect: "error",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: text,
      });
      // 响应可能回显凭据。脱敏后才允许进入工作区文件与日志。
      const raw = (await response.text()).replaceAll(key, "[REDACTED]");
      signal.throwIfAborted();
      if (!response.ok) throw new Error(`LLM request failed (HTTP ${response.status}).`);
      return raw;
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(
        error instanceof Error
          ? error.message.replaceAll(key, "[REDACTED]")
          : "LLM request failed.",
        { cause: error },
      );
    }
  };
}
