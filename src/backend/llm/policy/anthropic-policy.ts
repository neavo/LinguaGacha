import { patch_top_p } from "./policy-shared";
import { is_json_record } from "../../../domain/json";
import type { ModelRequestSnapshot } from "./policy-types";

/** Anthropic OneShot 只在 thinking 关闭时补齐 top_p，再进入共用扩展规则。 */
export function apply_anthropic_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  if (!is_anthropic_thinking_enabled(result["thinking"])) {
    patch_top_p(result, snapshot.generation, "top_p");
  }
  return apply_anthropic_request_overrides(result, snapshot);
}

/** 合并扩展字段；Pi 已生成的 thinking 与 effort 始终由结构化挡位拥有。 */
export function apply_anthropic_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  const native_thinking = result["thinking"];
  const native_output_config = is_json_record(result["output_config"])
    ? { ...result["output_config"] }
    : {};
  Object.assign(result, snapshot.extra_body);
  if (native_thinking !== undefined) {
    result["thinking"] = native_thinking;
    const output_config = is_json_record(result["output_config"])
      ? { ...result["output_config"] }
      : {};
    delete output_config["effort"];
    Object.assign(output_config, native_output_config);
    if (Object.keys(output_config).length === 0) {
      delete result["output_config"];
    } else {
      result["output_config"] = output_config;
    }
  }
  if (is_anthropic_thinking_enabled(native_thinking)) {
    delete result["temperature"];
    delete result["top_p"];
  }
  return result;
}

/** Pi 的 disabled 表示关闭，其余原生 thinking 类型均视为开启。 */
function is_anthropic_thinking_enabled(value: unknown): boolean {
  return is_json_record(value) && value["type"] !== "disabled";
}
