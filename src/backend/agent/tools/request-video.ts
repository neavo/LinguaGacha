import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { default_native_fs } from "../../../native/native-fs";
import type { JsonRecord } from "../../../domain/json";
import { resolve_model_endpoint } from "../../../domain/model-endpoint";
import { read_config_model_records } from "../../model/model-config-resolver";
import { get_primary_api_key } from "../../llm/llm-request";
import type { AgentWorkspaceRequestChannel } from "../workspace/runtime/request-channel";

const VIDEO_MODEL = "doubao-seed-2-1-lite-260915";
const VIDEO_INPUT_MAX_BYTES = 50_000_000;
const VIDEO_REQUEST_MAX_BYTES = 64_000_000;
const VIDEO_OUTPUT_TOKENS = 32768;
const REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("request_video"),
    file: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type WorkspaceVideoRequest = Static<typeof REQUEST_SCHEMA>;
export type WorkspaceVideoPort = (
  request: WorkspaceVideoRequest,
  signal: AbortSignal,
) => Promise<string>;

/** 工作区只接收脱敏后的响应文本，识别检查由技能拥有。 */
export function bind_request_video(channel: Pick<AgentWorkspaceRequestChannel, "call">) {
  return async (file: string, prompt: string): Promise<string> => {
    const result = await channel.call({ kind: "request_video", file, prompt });
    if (typeof result !== "string") throw new Error("Invalid video response.");
    return result;
  };
}

/** 宿主校验跨进程参数后借用当前执行的取消信号。 */
export async function execute_video_request(
  request: unknown,
  signal: AbortSignal,
  port: WorkspaceVideoPort | undefined,
): Promise<string> {
  signal.throwIfAborted();
  if (!Check(REQUEST_SCHEMA, request)) throw new Error("Invalid workspace video request.");
  if (!port) throw new Error("Video requests unavailable.");
  return port(request, signal);
}

/** 宿主读取凭据。运行器等待在途请求结算后释放占用。 */
export function create_video_requester(
  read_config: () => JsonRecord,
  fetcher: typeof fetch = fetch,
): WorkspaceVideoPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    const model = read_config_model_records(read_config()).find(
      (entry) => entry["id"] === "preset-volcengine",
    );
    if (
      !model ||
      typeof model["api_key"] !== "string" ||
      !model["api_key"].trim() ||
      typeof model["api_url"] !== "string" ||
      !model["api_url"].trim()
    )
      throw new Error("Configure the Volcengine preset address and API key first.");
    const key = get_primary_api_key(model["api_key"]);
    const endpoint = resolve_model_endpoint(model["api_url"], "OpenAIResponses", VIDEO_MODEL);
    const info = default_native_fs.stat(request.file);
    if (!info.isFile() || info.size === 0 || info.size >= VIDEO_INPUT_MAX_BYTES)
      throw new Error("Video segment must be a nonempty file smaller than 50 MB.");
    const bytes = default_native_fs.read_file(request.file);
    try {
      const body = JSON.stringify({
        model: VIDEO_MODEL,
        stream: false,
        reasoning: { effort: "low" },
        max_output_tokens: VIDEO_OUTPUT_TOKENS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_video",
                video_url: `data:video/mp4;base64,${bytes.toString("base64")}`,
                fps: 1,
              },
              { type: "input_text", text: request.prompt },
            ],
          },
        ],
      });
      // base64 膨胀和提示词共同计入供应商的请求体上限。
      if (Buffer.byteLength(body) > VIDEO_REQUEST_MAX_BYTES)
        throw new Error("Video request exceeds 64 MB; use a smaller segment.");
      const response = await fetcher(endpoint.base_url + "/responses", {
        method: "POST",
        redirect: "error",
        signal, // 请求沿用工作区执行时限，由运行器统一取消与收尾。
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body,
      });
      // 响应可能回显凭据；脱敏后才允许进入工作区文件与日志。
      const raw = (await response.text()).replaceAll(key, "[REDACTED]");
      signal.throwIfAborted();
      if (!response.ok) throw new Error(`Video request failed (HTTP ${response.status}).`);
      return raw;
    } catch (error) {
      signal.throwIfAborted();
      // 网络异常可能包含请求信息，不向脚本泄漏请求头与配置。
      throw new Error(
        error instanceof Error
          ? error.message.replaceAll(key, "[REDACTED]")
          : "Video request failed.",
        { cause: error },
      );
    }
  };
}
