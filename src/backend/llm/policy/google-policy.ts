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

/** Google OneShot 在 Pi config 上补齐项目生成与安全规则。 */
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

/** 合并扩展字段；Pi 已生成的思考配置始终由结构化挡位拥有。 */
export function apply_google_request_overrides(
  config: Record<string, unknown>,
  snapshot: ModelRequestSnapshot,
): Record<string, unknown> {
  const result = { ...config };
  const native_thinking_config = result["thinkingConfig"];
  Object.assign(result, snapshot.extra_body);
  if (native_thinking_config !== undefined) {
    result["thinkingConfig"] = native_thinking_config;
  }
  return result;
}
