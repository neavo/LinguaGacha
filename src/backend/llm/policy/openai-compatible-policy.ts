import { patch_generation_fields } from "./policy-shared";
import type { ModelThinkingLevel } from "../../../domain/model";
import type { JsonRecord } from "../../../domain/json";
import type { ModelRequestSnapshot } from "./policy-types";

const OPENAI_CHAT_COMPLETIONS_SUFFIX_PATTERN = /\/chat\/completions$/iu;

/** OpenAI-compatible 客户端会自行拼接路径，配置只保留接口根。 */
export function normalize_openai_compatible_base_url(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(OPENAI_CHAT_COMPLETIONS_SUFFIX_PATTERN, "");
}

/** OpenAI OneShot 只补 Pi options 未承载的生成字段，再进入共用模型覆盖规则。 */
export function apply_openai_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_generation_fields(result, snapshot.generation, {
    top_p: "top_p",
    presence_penalty: "presence_penalty",
    frequency_penalty: "frequency_penalty",
  });
  return apply_openai_request_overrides(result, snapshot);
}

/** Sakura 复用 OpenAI wire 结构，但不应用 OpenAI 模型族思考字段。 */
export function apply_sakura_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_generation_fields(result, snapshot.generation, {
    top_p: "top_p",
    presence_penalty: "presence_penalty",
    frequency_penalty: "frequency_penalty",
  });
  return Object.assign(result, snapshot.extra_body);
}

/**
 * 统一覆盖 OneShot 与 Pi payload 中的模型族字段，extra_body 保持最终优先级。
 */
export function apply_openai_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  for (const field of [
    "reasoning_effort",
    "reasoning",
    "thinking",
    "enable_thinking",
    "chat_template_kwargs",
  ]) {
    delete result[field];
  }
  const thinking = build_openai_thinking_payload(snapshot.model_id, snapshot.thinking_level);
  if (thinking !== null) {
    Object.assign(result, thinking);
  }
  return Object.assign(result, snapshot.extra_body);
}

/**
 * OpenAI-compatible 模型族差异统一收敛为最终请求字段。
 */
export function build_openai_thinking_payload(
  model_id: string,
  level: ModelThinkingLevel,
): JsonRecord | null {
  if (/gpt/iu.test(model_id)) {
    return { reasoning_effort: level === "OFF" ? "none" : level.toLowerCase() };
  }
  if (/qwen/iu.test(model_id)) {
    return { enable_thinking: level !== "OFF" };
  }
  if (/doubao-seed/iu.test(model_id)) {
    return { reasoning_effort: level === "OFF" ? "minimal" : level.toLowerCase() };
  }
  // https://platform.kimi.com/docs/guide/use-thinking-models
  if (/kimi-k3/iu.test(model_id)) {
    return { reasoning_effort: level === "HIGH" ? "high" : "low" };
  }
  // https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
  if (/deepseek-v4-flash/iu.test(model_id)) {
    return level === "OFF"
      ? { thinking: { type: "disabled" } }
      : {
          thinking: { type: "enabled" },
          reasoning_effort: level === "HIGH" ? "high" : "low",
        };
  }
  if (/deepseek|kimi|glm|mimo/iu.test(model_id)) {
    return { thinking: { type: level === "OFF" ? "disabled" : "enabled" } };
  }
  return null;
}
