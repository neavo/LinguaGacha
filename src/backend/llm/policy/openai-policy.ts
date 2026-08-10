import type { ModelThinkingLevel } from "../../../domain/model";
import { is_json_record, type JsonRecord } from "../../../domain/json";
import { resolve_model_thinking } from "./model-thinking-policy";
import { invalid_pi_payload, patch_top_p } from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

const OPENAI_ENDPOINT_SUFFIX_PATTERN = /\/(?:chat\/completions|responses)$/iu;
/** 项目策略接管所有已知思考字段，避免 Pi 与 extra_body 之前残留并行配置。 */
const OPENAI_THINKING_FIELDS = [
  "reasoning_effort",
  "reasoning",
  "thinking",
  "enable_thinking",
  "chat_template_kwargs",
] as const;

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
  return apply_openai_thinking_request_overrides("OpenAI", payload, snapshot);
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
  return apply_openai_thinking_request_overrides("OpenAIResponses", result, snapshot);
}

/**
 * OpenAI Chat Completions 与 Responses 的模型族差异统一收敛为最终请求字段。
 * 模型识别、支持挡位和降级统一由 model-thinking-policy 拥有。
 */
export function build_openai_thinking_payload(
  api_format: "OpenAI" | "OpenAIResponses",
  model_id: string,
  level: ModelThinkingLevel,
): JsonRecord | null {
  const resolved = resolve_model_thinking(api_format, model_id, level);
  if (resolved === null) return null;
  if (resolved.payload_kind === "openai_effort") {
    return { reasoning_effort: resolved.wire_level };
  }
  if (resolved.payload_kind === "openai_thinking_effort") {
    return resolved.effective_level === "off"
      ? { thinking: { type: resolved.wire_level } }
      : {
          thinking: { type: "enabled" },
          reasoning_effort: resolved.wire_level,
        };
  }
  if (resolved.payload_kind === "openai_thinking_toggle") {
    return { thinking: { type: resolved.wire_level } };
  }
  if (resolved.payload_kind === "responses_reasoning") {
    return { reasoning: { effort: resolved.wire_level } };
  }
  if (resolved.payload_kind === "responses_reasoning_summary") {
    return {
      reasoning: {
        effort: resolved.wire_level,
        ...(resolved.effective_level === "off" ? {} : { summary: "auto" }),
      },
    };
  }
  return null;
}

/** 清除 Pi 的思考字段后应用项目模型规则；显式 extra_body 始终最后覆盖。 */
function apply_openai_thinking_request_overrides(
  api_format: "OpenAI" | "OpenAIResponses",
  payload: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...payload };
  for (const field of OPENAI_THINKING_FIELDS) {
    delete result[field];
  }
  const thinking = build_openai_thinking_payload(
    api_format,
    snapshot.model_id,
    snapshot.thinking_level,
  );
  if (thinking !== null) {
    Object.assign(result, thinking);
  }
  return Object.assign(result, snapshot.extra_body);
}
