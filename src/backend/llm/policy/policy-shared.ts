import type { JsonRecord } from "../../../domain/json";
import type { ModelRequestSnapshot } from "./policy-types";

/**
 * 自定义数值只有开关为 true 才生效，避免默认 UI 值误入 payload。
 */
export function read_custom_number(generation: Readonly<JsonRecord>, key: string): number | null {
  if (generation[`${key}_custom_enable`] !== true) {
    return null;
  }
  const value = Number(generation[key]);
  return Number.isFinite(value) ? value : null;
}

/**
 * generation 字段按 provider 字段名映射，未启用的用户字段不进入 payload。
 */
export function patch_generation_fields(
  payload: Record<string, unknown>,
  generation: Readonly<JsonRecord>,
  field_map: Record<string, string>,
): void {
  for (const [source_key, target_key] of Object.entries(field_map)) {
    const value = read_custom_number(generation, source_key);
    if (value !== null) {
      payload[target_key] = value;
    }
  }
}

/**
 * 输出 token 自动值不发送给 OpenAI/Google，Anthropic 保留可用下限。
 */
export function resolve_max_tokens_for_request(
  snapshot: ModelRequestSnapshot,
  options: { auto_value?: number | null } = {},
): number | null {
  if (snapshot.output_token_limit !== 0 && snapshot.output_token_limit !== -1) {
    return Math.max(1, snapshot.output_token_limit);
  }
  return options.auto_value ?? null;
}
