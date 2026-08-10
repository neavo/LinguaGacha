import type { ModelThinkingLevel as PiModelThinkingLevel } from "@earendil-works/pi-ai";

import { patch_top_p } from "./policy-shared";
import { is_json_record } from "../../../domain/json";
import { resolve_model_thinking } from "./model-thinking-policy";
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
  patch_top_p(result, snapshot.generation, "top_p");
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
  const thinking = resolve_model_thinking("Anthropic", snapshot.model_id, snapshot.thinking_level);
  if (thinking !== null) {
    apply_anthropic_thinking(result, thinking.effective_level, thinking.wire_level);
  }
  if (thinking !== null && thinking.effective_level !== "off") {
    delete result["temperature"];
    delete result["top_p"];
  }
  return result;
}

/**
 * Claude 统一使用 adaptive thinking，并使用模型策略解析后的实际档位。
 */
function apply_anthropic_thinking(
  result: Record<string, unknown>,
  level: PiModelThinkingLevel,
  wire_level: string,
): void {
  result["thinking"] = { type: level === "off" ? "disabled" : "adaptive" };
  const output_config = is_json_record(result["output_config"])
    ? { ...result["output_config"] }
    : {};
  if (level === "off") {
    delete output_config["effort"];
  } else {
    output_config["effort"] = wire_level;
  }
  if (Object.keys(output_config).length === 0) {
    delete result["output_config"];
  } else {
    result["output_config"] = output_config;
  }
}
