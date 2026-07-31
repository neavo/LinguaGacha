import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "./policy-shared";
import { RequestValidationError } from "../../../shared/error";
import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";

const SAKURA_CHAT_COMPLETIONS_SUFFIX_PATTERN = /\/chat\/completions$/iu;

/**
 * SakuraLLM 走 OpenAI SDK client，base URL 只保留接口根路径。
 */
export function normalize_sakura_sdk_base_url(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(SAKURA_CHAT_COMPLETIONS_SUFFIX_PATTERN, "");
}

/**
 * SakuraLLM 使用 chat completions 请求形态，但响应由 SakuraTransport 转逐行 JSON map。
 */
export function build_sakura_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: snapshot.model_id,
    messages: normalize_sakura_chat_messages(messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  patch_temperature(payload, snapshot, { allow_thinking_temperature: true });
  patch_generation_fields(payload, snapshot.generation, {
    top_p: "top_p",
    presence_penalty: "presence_penalty",
    frequency_penalty: "frequency_penalty",
  });
  const max_tokens = resolve_max_tokens_for_request(snapshot);
  if (max_tokens !== null) {
    payload["max_tokens"] = max_tokens;
  }
  return apply_sakura_request_overrides(payload, snapshot);
}

/** Sakura 与 Pi OpenAI transport 共享结构，只追加项目启用的 extra_body。 */
export function apply_sakura_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  return Object.assign({ ...payload }, snapshot.extra_body);
}

/**
 * SakuraLLM 的 chat messages 在自身边界去空白，空请求直接阻断。
 */
function normalize_sakura_chat_messages(
  messages: LLMMessage[],
): Array<{ role: string; content: string }> {
  const result = messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content !== "");
  if (result.length === 0) {
    throw new RequestValidationError({
      public_details: { field: "messages" },
      diagnostic_context: { provider_policy: "sakura", reason: "empty_messages" },
    });
  }
  return result;
}
