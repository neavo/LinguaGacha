import type {
  ModelThinkingLevel as PiModelThinkingLevel,
  OpenAICompletionsCompat,
  ThinkingLevelMap,
} from "@earendil-works/pi-ai";

import type { ModelApiFormat } from "../../domain/model";

type CompleteThinkingLevelMap = Readonly<Record<PiModelThinkingLevel, string | null>>;

type ModelProtocolOverride = Readonly<{
  reasoning: boolean;
  thinking_level_map?: ThinkingLevelMap;
  compat?: OpenAICompletionsCompat;
}>;

export type ModelCapabilityOverride = Readonly<{
  model_id: string;
  capacity?: Readonly<{
    context_window: number;
    max_tokens: number;
  }>; // 容量以完整规格覆盖目录，独立于接入协议。
  protocols?: Readonly<Partial<Record<ModelApiFormat, ModelProtocolOverride>>>;
}>;

// 两种 OpenAI 协议共用档位语义；null 显式关闭 Pi 的默认档位回退。
const DOUBAO_THINKING_LEVEL_MAP: CompleteThinkingLevelMap = Object.freeze({
  off: "minimal", // 豆包以 minimal 表达关闭思考，产品不另设同义档位。
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: null,
});
const DEEPSEEK_THINKING_LEVEL_MAP: CompleteThinkingLevelMap = Object.freeze({
  off: "none",
  minimal: null,
  low: "low",
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
});

/** 只收录当前 Pi catalog 缺失或落后的精确修正；canonical matcher 负责常见前后缀。 */
export const MODEL_CAPABILITY_OVERRIDES: readonly ModelCapabilityOverride[] = Object.freeze([
  {
    model_id: "grok-4.6",
    protocols: {
      OpenAI: {
        reasoning: true,
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
    },
  },
  {
    model_id: "doubao-seed",
    protocols: {
      OpenAI: {
        reasoning: true,
        thinking_level_map: DOUBAO_THINKING_LEVEL_MAP,
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
      OpenAIResponses: {
        reasoning: true,
        thinking_level_map: DOUBAO_THINKING_LEVEL_MAP,
      },
    },
  },
  {
    model_id: "deepseek-flash",
    capacity: {
      context_window: 1_000_000,
      max_tokens: 384_000, // 模型最大输出规格，Agent 自动上限仍取产品档位与此值的较小值，用户设置优先。
    },
    protocols: {
      OpenAI: {
        reasoning: true,
        thinking_level_map: DEEPSEEK_THINKING_LEVEL_MAP,
        compat: { supportsReasoningEffort: true, thinkingFormat: "deepseek" },
      },
      OpenAIResponses: {
        reasoning: true,
        thinking_level_map: DEEPSEEK_THINKING_LEVEL_MAP,
      },
    },
  },
]);
