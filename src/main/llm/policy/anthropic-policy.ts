import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "../llm-client-policy";
import { RequestValidationError } from "../../../shared/error";
import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";

/**
 * Anthropic 规则：system 独立于 messages；thinking 开启时强制删除 temperature/top_p。
 */
export function build_anthropic_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const payload: Record<string, unknown> = {
    model: snapshot.model_id,
    messages: normalize_anthropic_chat_messages(
      messages.filter((message) => message.role !== "system"),
    ),
    stream: true,
    max_tokens: resolve_max_tokens_for_request(snapshot, { auto_value: 8192 }) ?? 8192,
  };
  if (system !== "") {
    payload["system"] = system;
  }
  patch_temperature(payload, snapshot);
  patch_generation_fields(payload, snapshot.generation, { top_p: "top_p" });
  Object.assign(payload, snapshot.extra_body);
  delete payload["presence_penalty"];
  delete payload["frequency_penalty"];
  const thinking = build_anthropic_thinking_payload(snapshot);
  if (thinking !== null) {
    payload["thinking"] = thinking;
  }
  if (snapshot.thinking_level !== "OFF" && thinking !== null) {
    delete payload["temperature"];
    delete payload["top_p"];
  }
  return payload;
}

/**
 * Anthropic messages 不包含 system role，并在自身边界去空白与阻断空请求。
 */
function normalize_anthropic_chat_messages(
  messages: LLMMessage[],
): Array<{ role: string; content: string }> {
  const result = messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content !== "");
  if (result.length === 0) {
    throw new RequestValidationError({
      public_details: { field: "messages" },
      diagnostic_context: { provider_policy: "anthropic", reason: "empty_messages" },
    });
  }
  return result;
}

/**
 * Claude thinking 开启时删除 temperature/top_p，因为 provider 不允许组合。
 */
export function build_anthropic_thinking_payload(
  snapshot: Pick<ModelRequestSnapshot, "model_id" | "thinking_level">,
): Record<string, unknown> | null {
  if (
    !/claude-3-7-sonnet|claude-opus-4-\d|claude-haiku-4-\d|claude-sonnet-4-\d/iu.test(
      snapshot.model_id,
    )
  ) {
    return null;
  }
  if (snapshot.thinking_level === "OFF") {
    return { type: "disabled" };
  }
  const budgets: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
    LOW: 1024,
    MEDIUM: 1536,
    HIGH: 2048,
  };
  return { type: "enabled", budget_tokens: budgets[snapshot.thinking_level] };
}
