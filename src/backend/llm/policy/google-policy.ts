import { resolve_model_thinking } from "./model-thinking-policy";
import { patch_top_p } from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

const GOOGLE_DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_API_VERSION_SEGMENT_PATTERN = /\/v1(?:beta|alpha)?$/iu;

/** Google REST 与 Pi 共用完整 API 地址；保留显式版本，缺失时补齐默认 v1beta。 */
export function normalize_google_api_base_url(url: string): string {
  const normalized = url.trim().replace(/\/+$/u, "");
  if (normalized === "") {
    return GOOGLE_DEFAULT_API_BASE_URL;
  }
  if (GOOGLE_API_VERSION_SEGMENT_PATTERN.test(normalized)) {
    return normalized;
  }
  return `${normalized}/v1beta`;
}

/** Google OneShot 在 Pi config 上补齐项目生成、安全和思考规则。 */
export function apply_google_one_shot_request_overrides(
  config: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
  signal: AbortSignal,
): Record<string, unknown> {
  const result = { ...config };
  patch_top_p(result, snapshot.generation, "topP");
  result["safetySettings"] = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ];
  return { ...apply_google_request_overrides(result, snapshot), abortSignal: signal };
}

/**
 * 统一覆盖 OneShot 与 Pi 的 Google config，extra_body 保持最终优先级。
 */
export function apply_google_request_overrides(
  config: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...config };
  delete result["thinkingConfig"];
  const thinking_config = build_google_thinking_config(snapshot);
  if (thinking_config !== null) {
    result["thinkingConfig"] = thinking_config;
  }
  return Object.assign(result, snapshot.extra_body);
}

/**
 * 使用统一模型思考策略生成 thinkingConfig；未收录代际只接受显式 extra_body。
 */
export function build_google_thinking_config(
  snapshot: Pick<ModelRequestSnapshot, "model_id" | "thinking_level">,
): Record<string, unknown> | null {
  const resolved = resolve_model_thinking("Google", snapshot.model_id, snapshot.thinking_level);
  return resolved?.payload_kind === "google_thinking_level"
    ? { thinkingLevel: resolved.wire_level }
    : null;
}
