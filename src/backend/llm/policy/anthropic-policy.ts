import { patch_generation_fields } from "./policy-shared";
import { is_json_record } from "../../../domain/json";
import type { ModelRequestSnapshot } from "./policy-types";

/** Anthropic OneShot 保持 string system 契约，补齐 top_p 后进入共用覆盖规则。 */
export function apply_anthropic_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  const system = result["system"];
  if (Array.isArray(system)) {
    const system_text = system
      .map((block) =>
        is_json_record(block) && typeof block["text"] === "string" ? block["text"] : "",
      )
      .filter(Boolean)
      .join("\n\n");
    if (system_text !== "") result["system"] = system_text;
  }
  patch_generation_fields(result, snapshot.generation, { top_p: "top_p" });
  return apply_anthropic_request_overrides(result, snapshot);
}

/**
 * 统一覆盖 OneShot 与 Pi payload；Claude thinking 规则高于 extra_body。
 */
export function apply_anthropic_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  delete result["thinking"];
  delete result["output_config"];
  Object.assign(result, snapshot.extra_body);
  delete result["presence_penalty"];
  delete result["frequency_penalty"];
  const thinking = build_anthropic_thinking_payload(snapshot);
  if (thinking !== null) {
    result["thinking"] = thinking;
  }
  if (snapshot.thinking_level !== "OFF" && thinking !== null) {
    delete result["temperature"];
    delete result["top_p"];
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
