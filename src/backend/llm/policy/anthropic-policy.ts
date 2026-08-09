import { patch_top_p } from "./policy-shared";
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
  apply_anthropic_thinking_level(result, snapshot.thinking_level);
  if (snapshot.thinking_level !== "OFF") {
    delete result["temperature"];
    delete result["top_p"];
  }
  return result;
}

/**
 * Claude 统一使用 adaptive thinking 与 effort 档位；具体模型支持范围交给供应商校验。
 */
function apply_anthropic_thinking_level(
  result: Record<string, unknown>,
  level: ModelRequestSnapshot["thinking_level"],
): void {
  result["thinking"] = { type: level === "OFF" ? "disabled" : "adaptive" };
  const output_config = is_json_record(result["output_config"])
    ? { ...result["output_config"] }
    : {};
  if (level === "OFF") {
    delete output_config["effort"];
  } else {
    output_config["effort"] = level.toLowerCase();
  }
  if (Object.keys(output_config).length === 0) {
    delete result["output_config"];
  } else {
    result["output_config"] = output_config;
  }
}
