import type {
  ModelThinkingLevel as PiModelThinkingLevel,
  ThinkingLevelMap,
} from "@earendil-works/pi-ai";

import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";

/** Pi 挡位的全序同时定义向下回退顺序；产品没有暴露 minimal。 */
const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly PiModelThinkingLevel[];

/** 产品持久化枚举只在策略边界投影为 Pi 枚举。 */
const PRODUCT_TO_PI_LEVEL = {
  OFF: "off",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const satisfies Record<ModelThinkingLevel, PiModelThinkingLevel>;

type CompleteThinkingLevelMap = Readonly<Record<PiModelThinkingLevel, string | null>>;

type ModelThinkingPayloadKind =
  | "openai_effort"
  | "openai_thinking_effort"
  | "openai_thinking_toggle"
  | "responses_reasoning"
  | "responses_reasoning_summary";

type ModelThinkingPolicy = Readonly<{
  payload_kind: ModelThinkingPayloadKind;
  level_map: CompleteThinkingLevelMap;
}>;

type ModelThinkingRule = ModelThinkingPolicy &
  Readonly<{
    api_format: ModelApiFormat;
    model_pattern: RegExp;
  }>;

/** 一次解析同时产出 Pi 有效档位、供应商线上值和完整能力映射。 */
export type ResolvedModelThinking = Readonly<{
  payload_kind: ModelThinkingPayloadKind;
  effective_level: PiModelThinkingLevel;
  wire_level: string;
  thinking_level_map: ThinkingLevelMap;
}>;

/** 从支持集合构造 Pi 所需的完整映射，未支持挡位显式保留为 null。 */
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

/** 首个匹配项生效；具体模型必须排在同协议的通用模型族之前。 */
const MODEL_THINKING_RULES: readonly ModelThinkingRule[] = Object.freeze([
  // OpenAI GPT（Chat Completions）：https://developers.openai.com/api/docs/guides/reasoning?api-mode=chat
  {
    api_format: "OpenAI",
    model_pattern: /gpt/iu,
    payload_kind: "openai_effort",
    level_map: define_level_map(["off", "low", "medium", "high", "xhigh", "max"], {
      off: "none",
    }),
  },
  // xAI Grok：https://docs.x.ai/developers/model-capabilities/text/reasoning
  {
    api_format: "OpenAI",
    model_pattern: /grok/iu,
    payload_kind: "openai_effort",
    level_map: define_level_map(["low", "medium", "high", "xhigh"]),
  },
  // 豆包 Seed：https://docs.volcengine.com/docs/82379/1449737?lang=zh#fc5eac89
  {
    api_format: "OpenAI",
    model_pattern: /doubao-seed/iu,
    payload_kind: "openai_effort",
    level_map: define_level_map(["minimal", "low", "medium", "high"]),
  },
  // 智谱 GLM-5.2：只保留三个实际挡位，其余产品挡位复用统一向下降挡。
  {
    api_format: "OpenAI",
    model_pattern: /glm-5\.2(?!\d)/iu,
    payload_kind: "openai_effort",
    level_map: define_level_map(["minimal", "high", "max"]),
  },
  // 智谱 GLM-5.3：只接受 low、high、max，其余产品挡位复用统一向下降挡。
  {
    api_format: "OpenAI",
    model_pattern: /glm-5\.3(?!\d)/iu,
    payload_kind: "openai_effort",
    level_map: define_level_map(["low", "high", "max"]),
  },
  // Kimi K3：https://platform.kimi.com/docs/guide/use-thinking-models
  {
    api_format: "OpenAI",
    model_pattern: /kimi-k3/iu,
    payload_kind: "openai_effort",
    level_map: define_level_map(["low", "high", "max"]),
  },
  // DeepSeek V4：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
  {
    api_format: "OpenAI",
    model_pattern: /deepseek-v4/iu,
    payload_kind: "openai_thinking_effort",
    level_map: define_level_map(["off", "low", "high", "max"], { off: "disabled" }),
  },
  // 兼容模型仅使用各供应商共同支持的思考开关：
  // GLM：https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode
  // Kimi：https://platform.kimi.com/docs/guide/use-thinking-models
  // MiMo：https://mimo.mi.com/docs/zh-CN/api/chat/responses
  {
    api_format: "OpenAI",
    model_pattern: /glm|kimi|mimo/iu,
    payload_kind: "openai_thinking_toggle",
    level_map: define_level_map(["off", "low"], { off: "disabled", low: "enabled" }),
  },
  // OpenAI GPT（Responses）：https://developers.openai.com/api/docs/guides/reasoning
  {
    api_format: "OpenAIResponses",
    model_pattern: /gpt/iu,
    payload_kind: "responses_reasoning_summary",
    level_map: define_level_map(["off", "low", "medium", "high", "xhigh", "max"], {
      off: "none",
    }),
  },
  // xAI Grok：https://docs.x.ai/developers/model-capabilities/text/reasoning
  {
    api_format: "OpenAIResponses",
    model_pattern: /grok/iu,
    payload_kind: "responses_reasoning",
    level_map: define_level_map(["low", "medium", "high", "xhigh"]),
  },
  // 豆包 Seed：https://docs.volcengine.com/docs/82379/1449737?lang=zh#fc5eac89
  {
    api_format: "OpenAIResponses",
    model_pattern: /doubao-seed/iu,
    payload_kind: "responses_reasoning",
    level_map: define_level_map(["minimal", "low", "medium", "high"]),
  },
  // DeepSeek V4：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
  {
    api_format: "OpenAIResponses",
    model_pattern: /deepseek-v4/iu,
    payload_kind: "responses_reasoning",
    level_map: define_level_map(["off", "low", "high", "max"], { off: "none" }),
  },
  // https://mimo.mi.com/docs/zh-CN/api/chat/responses
  {
    api_format: "OpenAIResponses",
    model_pattern: /mimo/iu,
    payload_kind: "responses_reasoning",
    level_map: define_level_map(["off", "low", "medium", "high"], { off: "none" }),
  },
]);

/**
 * 解析模型思考能力并只向更低挡位回退；模型没有更低非关闭挡位时使用最低可用挡位。
 */
export function resolve_model_thinking(
  api_format: ModelApiFormat,
  model_id: string,
  requested_level: ModelThinkingLevel,
): ResolvedModelThinking | null {
  const policy = resolve_model_thinking_policy(api_format, model_id);
  if (policy === null) return null;
  const effective_level = resolve_effective_model_thinking_level(
    true,
    policy.level_map,
    requested_level,
  );
  const wire_level = policy.level_map[effective_level];
  if (wire_level === null) return null;
  return {
    payload_kind: policy.payload_kind,
    effective_level,
    wire_level,
    thinking_level_map: policy.level_map,
  };
}

/**
 * 从 Pi 模型能力应用产品的向下降档规则；xhigh/max 只有显式映射才视为支持。
 */
export function resolve_effective_model_thinking_level(
  reasoning: boolean,
  level_map: ThinkingLevelMap | undefined,
  requested_level: ModelThinkingLevel,
): PiModelThinkingLevel {
  if (!reasoning) return "off";
  const supports = (level: PiModelThinkingLevel): boolean => {
    const mapped = level_map?.[level];
    if (mapped === null) return false;
    return level === "xhigh" || level === "max" ? mapped !== undefined : true;
  };
  const requested_pi_level = PRODUCT_TO_PI_LEVEL[requested_level];
  if (supports(requested_pi_level)) return requested_pi_level;
  const requested_index = PI_THINKING_LEVELS.indexOf(requested_pi_level);
  if (requested_pi_level !== "off") {
    for (let index = requested_index - 1; index > 0; index -= 1) {
      const candidate = PI_THINKING_LEVELS[index];
      if (candidate !== undefined && supports(candidate)) return candidate;
    }
  }
  return PI_THINKING_LEVELS.slice(1).find(supports) ?? "off";
}

/** 规则按声明顺序首个命中，协议边界阻止同名模型跨 adapter 串用策略。 */
function resolve_model_thinking_policy(
  api_format: ModelApiFormat,
  model_id: string,
): ModelThinkingPolicy | null {
  return (
    MODEL_THINKING_RULES.find(
      (rule) => rule.api_format === api_format && rule.model_pattern.test(model_id),
    ) ?? null
  );
}
