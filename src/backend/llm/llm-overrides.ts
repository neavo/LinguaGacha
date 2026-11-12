import type {
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
  AnthropicMessagesCompat,
  ThinkingLevelMap,
} from "@earendil-works/pi-ai";

import type { ModelApiFormat } from "../../domain/model";

/** 按协议约束 SDK 兼容参数，避免将其他协议的字段用于当前请求。 */
type ModelProtocolCompat = {
  OpenAI: OpenAICompletionsCompat;
  OpenAIResponses: OpenAIResponsesCompat;
  Anthropic: AnthropicMessagesCompat;
  Google: never;
  SakuraLLM: OpenAICompletionsCompat;
};

/** 产品请求策略由载荷层消费，独立于 SDK 的 `compat`。 */
export type ModelRequestPolicy = Readonly<{
  responses_audio_format?: "data_uri" | "audio_url"; // 缺省为嵌套 input_audio，供应商差异只改变编码。
  supports_reasoning_summary?: false; // 缺省沿用 SDK，仅声明需要关闭的自动参数。
}>;

/** 按模型族与协议补齐能力和请求规则，适用于所有接入地址。 */
export type ModelCapabilityOverride = Readonly<{
  model_id: string;
  protocols: {
    readonly [Format in ModelApiFormat]?: Readonly<{
      reasoning?: boolean;
      thinking_level_map?: ThinkingLevelMap;
      compat?: ModelProtocolCompat[Format];
      request?: ModelRequestPolicy;
    }>;
  };
}>;

/** 补齐 Pi 内置目录缺失或落后的事实，上游补齐并验证后删除对应修正。 */
export const MODEL_CAPABILITY_OVERRIDES: readonly ModelCapabilityOverride[] = Object.freeze([
  {
    model_id: "qwen3.8-omni",
    protocols: {
      // https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses
      OpenAIResponses: { request: { responses_audio_format: "data_uri" } },
    },
  },
  // Pi 按 xAI 端点禁用 Chat Completions 的 `reasoning_effort`，这两个模型需显式启用。
  {
    model_id: "grok-4.6",
    protocols: {
      OpenAI: {
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
    },
  },
  {
    model_id: "grok-4.7",
    protocols: {
      OpenAI: {
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
    },
  },
  // 第三方模型别名沿用官方 `deepseek-flash` 等级，null 显式关闭 Pi 的默认等级回退。
  {
    model_id: "deepseek-v4.1-flash",
    protocols: {
      OpenAI: {
        reasoning: true,
        thinking_level_map: {
          off: "none", // 显式覆盖第三方模板的 `off: null`，恢复关闭思考。
          minimal: null,
          low: "low",
          medium: null,
          high: "high",
          xhigh: null,
          max: "max",
        },
        compat: {
          supportsStore: false,
          supportsReasoningEffort: true, // Pi 可能按中转端点禁用 effort，模型修正须显式启用。
          maxTokensField: "max_tokens",
          requiresReasoningContentOnAssistantMessages: true,
          thinkingFormat: "deepseek",
          supportsStrictMode: true,
        },
      },
      OpenAIResponses: {
        reasoning: true,
        thinking_level_map: {
          off: "none",
          minimal: null,
          low: "low",
          medium: null,
          high: "high",
          xhigh: null,
          max: "max",
        },
      },
    },
  },
  {
    model_id: "doubao-seed",
    protocols: {
      OpenAI: {
        reasoning: true,
        thinking_level_map: {
          off: "minimal", // 豆包以 minimal 表达关闭思考，产品不另设同义等级。
          minimal: null,
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: null,
          max: null,
        },
        compat: { supportsReasoningEffort: true, thinkingFormat: "openai" },
      },
      OpenAIResponses: {
        reasoning: true,
        thinking_level_map: {
          off: "minimal",
          minimal: null,
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: null,
          max: null,
        },
        // https://docs.volcengine.com/docs/ark/create-model-responses-api：音频使用 audio_url，且不接受 reasoning.summary。
        request: { responses_audio_format: "audio_url", supports_reasoning_summary: false },
      },
    },
  },
]);

type EndpointRequestOverride = Readonly<{
  hostname: string;
  session_header: string; // 请求时填入当前任务或对话的会话 ID。
}>;

/** 接入点按精确主机名匹配，会话头用于标识同一任务或对话的推理请求。 */
export const ENDPOINT_REQUEST_OVERRIDES: readonly EndpointRequestOverride[] = Object.freeze([
  {
    hostname: "opencode.ai",
    session_header: "x-opencode-session",
  },
]);
