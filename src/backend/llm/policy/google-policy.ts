import {
  patch_generation_fields,
  patch_temperature,
  resolve_max_tokens_for_request,
} from "../llm-client-policy";
import { RequestValidationError } from "../../../shared/error";
import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";

// Google SDK 会自行拼接版本段；这里只识别用户配置末尾的显式版本。
const GOOGLE_SDK_VERSION_SEGMENT_PATTERN = /\/v1(?:beta|alpha)?$/iu;
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

/**
 * Google SDK 会按 apiVersion 拼路径，base URL 末尾不能再携带 v1/v1beta/v1alpha。
 */
export function normalize_google_sdk_base_url(url: string): string {
  return url.trim().replace(/\/+$/u, "").replace(GOOGLE_SDK_VERSION_SEGMENT_PATTERN, "");
}

/**
 * Google / Gemini 规则：官方 SDK 消费 contents + config，安全阈值始终显式写入 config。
 */
export function build_google_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  patch_temperature(config, snapshot, { allow_thinking_temperature: true });
  patch_generation_fields(config, snapshot.generation, {
    top_p: "topP",
    presence_penalty: "presencePenalty",
    frequency_penalty: "frequencyPenalty",
  });
  const max_tokens = resolve_max_tokens_for_request(snapshot);
  if (max_tokens !== null) {
    config["maxOutputTokens"] = max_tokens;
  }
  config["safetySettings"] = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  ];
  const thinking_config = build_google_thinking_config(snapshot);
  if (thinking_config !== null) {
    config["thinkingConfig"] = thinking_config;
  }
  Object.assign(config, snapshot.extra_body);
  return {
    model: snapshot.model_id,
    contents: build_google_contents(messages),
    config,
  };
}

/**
 * Gemini 没有 system role 时，把 system 文本合并为首条 user content。
 */
function build_google_contents(
  messages: LLMMessage[],
): Array<{ role: string; parts: Array<{ text: string }> }> {
  const system_text = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content.trim() }],
    }))
    .filter((message) => message.parts[0]?.text !== "");
  if (system_text !== "") {
    contents.unshift({ role: "user", parts: [{ text: system_text }] });
  }
  if (contents.length === 0) {
    throw new RequestValidationError({
      public_details: { field: "messages" },
      diagnostic_context: { provider_policy: "google", reason: "empty_messages" },
    });
  }
  return contents;
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
  if (/gemini-3(?:\.1)?-flash/iu.test(model_id)) {
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
