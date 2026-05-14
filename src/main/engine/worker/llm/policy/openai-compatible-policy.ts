import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "../llm-client-policy";
import type { ModelThinkingLevel } from "../../../../../base/model";
import type { ApiJsonValue } from "../../../../api/api-types";
import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";

/**
 * OpenAI-compatible 族规则：用户 extra_body 最后合并，模型族强制字段在其前写入。
 */
export function build_openai_compatible_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: snapshot.model_id,
    messages: normalize_chat_messages(messages),
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
  Object.assign(
    payload,
    build_openai_model_family_body(snapshot.model_id, snapshot.thinking_level),
    snapshot.extra_body,
  );
  return payload;
}

/**
 * Chat messages 在 OpenAI-compatible 边界去空白，空请求直接阻断。
 */
export function normalize_chat_messages(
  messages: LLMMessage[],
): Array<{ role: string; content: string }> {
  const result = messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content !== "");
  if (result.length === 0) {
    throw new Error("LLM 请求 messages 为空。");
  }
  return result;
}

/**
 * OpenAI-compatible 模型族差异统一收敛为最终请求字段。
 */
function build_openai_model_family_body(
  model_id: string,
  level: ModelThinkingLevel,
): Record<string, ApiJsonValue> {
  if (/gpt-5/iu.test(model_id)) {
    return { reasoning_effort: level === "OFF" ? "none" : level.toLowerCase() };
  }
  if (/qwen3\.5/iu.test(model_id)) {
    return { enable_thinking: level !== "OFF" };
  }
  if (/doubao-seed-(?:1-6|1-8|2-0)/iu.test(model_id)) {
    return { reasoning_effort: level === "OFF" ? "minimal" : level.toLowerCase() };
  }
  if (/deepseek|kimi|glm/iu.test(model_id)) {
    return { thinking: { type: level === "OFF" ? "disabled" : "enabled" } };
  }
  return {};
}
