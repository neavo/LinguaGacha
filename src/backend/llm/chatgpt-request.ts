import type { StreamOptions } from "@earendil-works/pi-ai";
import { is_json_record } from "../../domain/json";
import { CHATGPT_BASE_URL } from "../../domain/model";
import { AppError } from "../../shared/error";
import { create_provider_error, read_provider_response_error } from "../network/provider-error";

const UNSUPPORTED_FIELDS = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "prompt_cache_options",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
  "previous_response_id",
] as const;
const TOOL_NAMESPACE = "linguagacha";

/** 清理 SDK 自动参数后合并用户扩展；显式冲突报错，不能静默吞掉用户设置。 */
export function apply_chatgpt_payload(
  record: Record<string, unknown>,
  extensions: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  for (const field of UNSUPPORTED_FIELDS) delete record[field];
  const result = { ...record, ...extensions };
  for (const field of UNSUPPORTED_FIELDS)
    if (result[field] !== undefined) throw rejected(`Unsupported field: ${field}`);
  if (result["store"] !== false || result["stream"] !== true || !Array.isArray(result["input"]))
    throw rejected("ChatGPT requires store:false, stream:true and an input array");
  result["input"] = result["input"].map((item: unknown) =>
    is_json_record(item) && item["role"] === "system" ? { ...item, role: "developer" } : item,
  );
  const tools = result["tools"];
  if (Array.isArray(tools)) {
    const functions = tools.filter(
      (tool: unknown) =>
        is_json_record(tool) && ["function", "custom"].includes(String(tool["type"])),
    );
    const other = tools.filter((tool: unknown) => !functions.includes(tool));
    if (
      other.some(
        (tool: unknown) =>
          !is_json_record(tool) ||
          !["namespace", "web_search", "web_search_preview"].includes(String(tool["type"])),
      )
    )
      throw rejected("Unsupported ChatGPT tool");
    result["tools"] = [
      ...other,
      ...(functions.length === 0
        ? []
        : [{ type: "namespace", name: TOOL_NAMESPACE, tools: functions }]),
    ];
    const choice = result["tool_choice"];
    if (is_json_record(choice) && ["function", "custom"].includes(String(choice["type"])))
      result["tool_choice"] = { ...choice, namespace: TOOL_NAMESPACE };
  }
  return result;
}

/** 将本地载荷校验失败标为不可重试，并保留具体字段消息。 */
function rejected(reason: string): AppError {
  return create_provider_error(reason, undefined, { retryable: false });
}

/** 请求私有观察器保留 HTTP 与 SSE 错误事实，避免依赖 Pi 格式化后的错误文本。 */
export function observe_chatgpt_request(base_fetch: typeof fetch = globalThis.fetch): {
  options: Pick<StreamOptions, "fetch" | "onProviderStreamEvent">;
  failure: () => { error: AppError; retryable: boolean } | null;
} {
  let failure: { error: AppError; retryable: boolean } | null = null;
  let request_id: string | undefined;
  const record = (error: AppError): void => {
    const code = error.diagnostic_context["provider_code"];
    const status = error.diagnostic_context["status"];
    const retryable =
      code === "subscription_sharing_usage_unavailable" ||
      code === "subscription_sharing_user_unavailable" ||
      (code !== "subscription_sharing_usage_limit_exceeded" &&
        (status === 429 || (typeof status === "number" && status >= 500)));
    Object.assign(error.diagnostic_context, { request_id, retryable });
    failure = { error, retryable };
  };
  return {
    failure: () => failure,
    options: {
      fetch: async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        if (url.origin !== new URL(CHATGPT_BASE_URL).origin)
          throw rejected("Invalid ChatGPT request origin");
        const response = await base_fetch(input, { ...init, redirect: "error" });
        request_id =
          response.headers.get("x-request-id") ??
          response.headers.get("openai-request-id") ??
          undefined;
        if (!response.ok) {
          record(await read_provider_response_error(response.clone()));
        }
        return response;
      },
      onProviderStreamEvent: (value) => {
        if (!is_json_record(value)) return;
        if (value["type"] === "response.failed") record(create_provider_error(value["response"]));
        else if (value["type"] === "error") record(create_provider_error(value));
      },
    },
  };
}
