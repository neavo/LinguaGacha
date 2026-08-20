import { is_json_record } from "../../../domain/json";
import { invalid_pi_payload, patch_top_p } from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

const OPENAI_ENDPOINT_SUFFIX_PATTERN = /\/(?:chat\/completions|responses)$/iu;
/** OpenAI SDK 会自行拼接端点，配置只保留 API 根地址。 */
export function normalize_openai_sdk_base_url(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(OPENAI_ENDPOINT_SUFFIX_PATTERN, "");
}

/** Chat Completions OneShot 补齐 Pi options 未承载的生成字段。 */
export function apply_openai_completions_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_top_p(result, snapshot.generation, "top_p");
  return apply_openai_completions_request_overrides(result, snapshot);
}

/** Responses OneShot 只补当前协议支持且 Pi options 未承载的 top_p。 */
export function apply_openai_responses_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_top_p(result, snapshot.generation, "top_p");
  return apply_openai_responses_request_overrides(result, snapshot);
}

/** Sakura 复用 Chat Completions wire 结构，但不应用 OpenAI 模型族思考字段。 */
export function apply_sakura_one_shot_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  patch_top_p(result, snapshot.generation, "top_p");
  return Object.assign(result, snapshot.extra_body);
}

/** Chat Completions 模型族字段由项目策略生成，extra_body 保持最终优先级。 */
export function apply_openai_completions_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  return Object.assign({ ...payload }, snapshot.extra_body);
}

/** Responses 保留 Pi 生成的 Items 与 tools，项目统一应用指令角色和模型族思考字段。 */
export function apply_openai_responses_request_overrides(
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const input = payload["input"];
  if (!Array.isArray(input)) {
    throw invalid_pi_payload("OpenAIResponses", "input");
  }
  const result = {
    ...payload,
    input: input.map((item) =>
      is_json_record(item) && item["role"] === "system" ? { ...item, role: "developer" } : item,
    ),
  };
  return Object.assign(result, snapshot.extra_body);
}
