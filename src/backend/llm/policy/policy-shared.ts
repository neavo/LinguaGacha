import type { JsonRecord } from "../../../domain/json";
import type { ModelApiFormat } from "../../../domain/model";
import * as AppErrors from "../../../shared/error";
import type { ModelRequestSnapshot } from "./policy-types";

/** 统一构造 Pi payload 结构异常，保留 API 格式与可选字段定位。 */
export function invalid_pi_payload(
  api_format: ModelApiFormat,
  field?: string,
): AppErrors.InternalInvariantError {
  return new AppErrors.InternalInvariantError({
    diagnostic_context: {
      reason: "invalid_model_request_payload",
      api_format,
      ...(field === undefined ? {} : { field }),
    },
  });
}

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

/** top_p 只有显式启用时才按 provider 字段名写入 payload。 */
export function patch_top_p(
  payload: Record<string, unknown>,
  generation: Readonly<JsonRecord>,
  target_key: "top_p" | "topP",
): void {
  const value = read_custom_number(generation, "top_p");
  if (value !== null) {
    payload[target_key] = value;
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
