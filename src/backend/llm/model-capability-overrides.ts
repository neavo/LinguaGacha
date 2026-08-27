import type {
  ModelThinkingLevel as PiModelThinkingLevel,
  OpenAICompletionsCompat,
  ThinkingLevelMap,
} from "@earendil-works/pi-ai";

import type { ModelApiFormat } from "../../domain/model";

type CompleteThinkingLevelMap = Readonly<Record<PiModelThinkingLevel, string | null>>;

export type ModelCapabilityOverride = Readonly<{
  api_format: Extract<ModelApiFormat, "OpenAI" | "OpenAIResponses">;
  model_id: string;
  thinking_level_map?: ThinkingLevelMap;
  compat?: OpenAICompletionsCompat;
}>;

/** 用完整 null 映射表达 Pi 支持集合，避免未声明档位沿用 adapter 默认行为。 */
function define_level_map(
  supported_levels: readonly PiModelThinkingLevel[],
  wire_values: Partial<Record<PiModelThinkingLevel, string>> = {},
): CompleteThinkingLevelMap {
  const level_map: Record<PiModelThinkingLevel, string | null> = {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  };
  for (const level of supported_levels) {
    level_map[level] = wire_values[level] ?? level;
  }
  return Object.freeze(level_map);
}

/** 只收录当前 Pi catalog 缺失或落后的精确修正；canonical matcher 负责常见前后缀。 */
export const MODEL_CAPABILITY_OVERRIDES: readonly ModelCapabilityOverride[] = Object.freeze([
  {
    api_format: "OpenAI",
    model_id: "z-ai/glm-5.3",
    thinking_level_map: define_level_map(["low", "high", "max"]),
    compat: { supportsReasoningEffort: true, thinkingFormat: "openrouter" },
  },
  {
    api_format: "OpenAIResponses",
    model_id: "z-ai/glm-5.3",
    thinking_level_map: define_level_map(["low", "high", "max"]),
  },
  {
    api_format: "OpenAI",
    model_id: "grok-4.6",
    compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
  },
  {
    api_format: "OpenAI",
    model_id: "doubao-seed",
    thinking_level_map: define_level_map(["minimal", "low", "medium", "high"]),
    compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
  },
  {
    api_format: "OpenAIResponses",
    model_id: "doubao-seed",
    thinking_level_map: define_level_map(["minimal", "low", "medium", "high"]),
  },
  {
    api_format: "OpenAI",
    model_id: "deepseek-v4-pro",
    thinking_level_map: define_level_map(["off", "low", "high", "max"], {
      off: "disabled",
    }),
    compat: { supportsReasoningEffort: true, thinkingFormat: "deepseek" },
  },
  {
    api_format: "OpenAIResponses",
    model_id: "deepseek-v4",
    thinking_level_map: define_level_map(["off", "low", "high", "max"], { off: "none" }),
  },
  {
    api_format: "OpenAI",
    model_id: "mimo-v2.5",
    thinking_level_map: define_level_map(["off", "high"]),
    compat: { supportsReasoningEffort: false, thinkingFormat: "deepseek" },
  },
  {
    api_format: "OpenAIResponses",
    model_id: "mimo-v2.5",
    thinking_level_map: define_level_map(["off", "high"], { off: "none" }),
  },
]);
