import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "../llm-client-policy";
import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";

/**
 * Google / Gemini 规则：官方 SDK 消费 contents + config，安全阈值始终显式写入 config。
 */
export function build_google_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  patch_temperature(config, snapshot, { allow_thinking_temperature: true });
  patch_generation_fields(config, snapshot.generation, {
    top_p: "topP",
    presence_penalty: "presencePenalty",
    frequency_penalty: "frequencyPenalty",
  });
  const max_tokens = resolve_max_tokens_for_request(snapshot);
  if (max_tokens !== null) {
    config["maxOutputTokens"] = max_tokens;
  }
  config["safetySettings"] = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ];
  const thinking_config = build_google_thinking_config(snapshot);
  if (thinking_config !== null) {
    config["thinkingConfig"] = thinking_config;
  }
  Object.assign(config, snapshot.extra_body);
  return {
    model: snapshot.model_id,
    contents: build_google_contents(messages),
    config,
  };
}

/**
 * Gemini 没有 system role 时，把 system 文本合并为首条 user content。
 */
function build_google_contents(
  messages: LLMMessage[],
): Array<{ role: string; parts: Array<{ text: string }> }> {
  const system_text = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content.trim() }],
    }))
    .filter((message) => message.parts[0]?.text !== "");
  if (system_text !== "") {
    contents.unshift({ role: "user", parts: [{ text: system_text }] });
  }
  if (contents.length === 0) {
    throw new Error("LLM 请求 messages 为空。");
  }
  return contents;
}

/**
 * Gemini thinking 字段由模型族决定：2.5 用预算，3 系用 level。
 */
export function build_google_thinking_config(
  snapshot: Pick<ModelRequestSnapshot, "model_id" | "thinking_level">,
): Record<string, unknown> | null {
  const model_id = snapshot.model_id;
  const level = snapshot.thinking_level;
  const budgets: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
    LOW: 384,
    MEDIUM: 768,
    HIGH: 1024,
  };
  if (/gemini-3-pro/iu.test(model_id)) {
    return { thinkingLevel: level === "HIGH" ? "HIGH" : "LOW", includeThoughts: true };
  }
  if (/gemini-3\.1-pro/iu.test(model_id)) {
    return {
      thinkingLevel: level === "HIGH" ? "HIGH" : level === "MEDIUM" ? "MEDIUM" : "LOW",
      includeThoughts: true,
    };
  }
  if (/gemini-3(?:\.1)?-flash/iu.test(model_id)) {
    return { thinkingLevel: level === "OFF" ? "MINIMAL" : level, includeThoughts: true };
  }
  if (/gemini-2\.5-pro/iu.test(model_id)) {
    return { thinkingBudget: level === "OFF" ? 128 : budgets[level], includeThoughts: true };
  }
  if (/gemini-2\.5-flash/iu.test(model_id)) {
    return {
      thinkingBudget: level === "OFF" ? 0 : budgets[level],
      includeThoughts: level !== "OFF",
    };
  }
  return null;
}
