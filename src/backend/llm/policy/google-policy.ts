import { patch_generation_fields } from "./policy-shared";
import type { ModelRequestSnapshot } from "./policy-types";

const GOOGLE_DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_API_VERSION_SEGMENT_PATTERN = /\/v1(?:beta|alpha)?$/iu;
const GOOGLE_25_PRO_MIN_THINKING_BUDGET = 128;

const GOOGLE_25_THINKING_BUDGET_BY_LEVEL = {
  LOW: 384,
  MEDIUM: 768,
  HIGH: 1024,
} as const satisfies Record<"LOW" | "MEDIUM" | "HIGH", number>;

const GOOGLE_25_FLASH_LITE_THINKING_BUDGET_BY_LEVEL = {
  LOW: 512,
  MEDIUM: 768,
  HIGH: 1024,
} as const satisfies Record<"LOW" | "MEDIUM" | "HIGH", number>;

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
  patch_generation_fields(result, snapshot.generation, {
    top_p: "topP",
    presence_penalty: "presencePenalty",
    frequency_penalty: "frequencyPenalty",
  });
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
 * Gemini thinking 字段由模型族决定：2.5 用预算，3 系用等级。
 */
export function build_google_thinking_config(
  snapshot: Pick<ModelRequestSnapshot, "model_id" | "thinking_level">,
): Record<string, unknown> | null {
  const model_id = snapshot.model_id;
  const level = snapshot.thinking_level;
  if (/gemini-3\.1-pro/iu.test(model_id)) {
    return {
      thinkingLevel: level === "HIGH" ? "HIGH" : level === "MEDIUM" ? "MEDIUM" : "LOW",
      includeThoughts: level !== "OFF",
    };
  }
  if (/gemini-3(?:\.\d+)?-pro/iu.test(model_id)) {
    return { thinkingLevel: level === "HIGH" ? "HIGH" : "LOW", includeThoughts: level !== "OFF" };
  }
  if (/gemini-3(?:\.(?:1|5))?-flash/iu.test(model_id)) {
    return {
      thinkingLevel: level === "OFF" ? "MINIMAL" : level,
      includeThoughts: level !== "OFF",
    };
  }
  if (/gemini-2\.5-pro/iu.test(model_id)) {
    return {
      thinkingBudget:
        level === "OFF"
          ? GOOGLE_25_PRO_MIN_THINKING_BUDGET
          : GOOGLE_25_THINKING_BUDGET_BY_LEVEL[level],
      includeThoughts: level !== "OFF",
    };
  }
  if (/gemini-2\.5-flash-lite/iu.test(model_id)) {
    return {
      thinkingBudget: level === "OFF" ? 0 : GOOGLE_25_FLASH_LITE_THINKING_BUDGET_BY_LEVEL[level],
      includeThoughts: level !== "OFF",
    };
  }
  if (/gemini-2\.5-flash/iu.test(model_id)) {
    return {
      thinkingBudget: level === "OFF" ? 0 : GOOGLE_25_THINKING_BUDGET_BY_LEVEL[level],
      includeThoughts: level !== "OFF",
    };
  }
  return null;
}
