import {
  getSupportedThinkingLevels,
  type Api,
  type Model as PiModel,
  type ModelThinkingLevel as PiModelThinkingLevel,
  type ThinkingLevelMap,
} from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

import {
  MODEL_THINKING_LEVELS,
  type Model,
  type ModelApiFormat,
  type ModelThinkingLevel,
} from "../../domain/model";
import {
  AGENT_COMPACTION_RESERVE_TOKENS,
  DEFAULT_MODEL_AGENT_CONFIG,
  normalize_model_agent_config,
  type ModelAgentConfig,
  type ModelAgentLimits,
} from "../../domain/model-agent";
import {
  MODEL_CAPABILITY_OVERRIDES,
  type ModelCapabilityOverride,
} from "./model-capability-overrides";

/** 模型容量规格缺失时的安全运行容量；不据模型名猜测规格。 */
const FALLBACK_AGENT_LIMITS: ModelAgentLimits = Object.freeze({
  context_window: 256_000,
  max_output_tokens: 32_000,
});
/** 自动输出档位的上下文分界；产品规则只影响自动值，不限制用户显式值。 */
const LARGE_CONTEXT_WINDOW_THRESHOLD = 500_000;
const SMALL_AUTOMATIC_OUTPUT_LIMIT = 32_000;
const LARGE_AUTOMATIC_OUTPUT_LIMIT = 64_000;

/** 产品档位到 Pi 档位的唯一投影，未进入该表的值不会发给 adapter。 */
const PRODUCT_TO_PI_LEVEL = {
  OFF: "off",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const satisfies Record<ModelThinkingLevel, PiModelThinkingLevel>;

/** 同协议存在多条 Pi 思考模板时，原生供应商优先于代理供应商。 */
const NATIVE_PROVIDER_ORDER = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "moonshotai",
  "moonshotai-cn",
  "xiaomi",
  "zai",
  "zai-coding-cn",
] as const;

type PiCatalogModel = PiModel<Api>;

export type ResolvedModelCapability = Readonly<{
  agent_config: ModelAgentConfig; // 可持久化的用户配置，0 保留自动语义。
  agent_limits: ModelAgentLimits; // 合并产品策略与用户配置后的运行容量。
  available_thinking_levels: readonly ModelThinkingLevel[];
  context_window: number | null; // 模型规格；缺少证据时为 null。
  max_tokens: number | null; // 模型最大输出规格，独立于 Agent 自动输出档位。
  reasoning: boolean;
  thinking_level_map?: ThinkingLevelMap;
  compat?: PiCatalogModel["compat"];
}>;

type ModelCapabilityInput = Pick<Model, "api_format" | "model_id" | "agent">;

/** 启动时冻结 Pi 内置目录，所有模型能力消费方共享这一份事实快照。 */
const PI_CATALOG_MODELS: readonly PiCatalogModel[] = Object.freeze(
  getBuiltinProviders().flatMap((provider) => getBuiltinModels(provider)),
);

/**
 * 解析唯一运行能力；模型容量与协议思考能力分别采用应用修正，再合并用户 Agent 配置。
 */
export function resolve_model_capability(model: ModelCapabilityInput): ResolvedModelCapability {
  const matches = match_pi_catalog_models(model.model_id, PI_CATALOG_MODELS);
  const pi_template = select_pi_thinking_template(model.api_format, matches);
  const app_override = match_model_capability_override(model.model_id);
  const protocol_override = app_override?.protocols?.[model.api_format];
  const reasoning = protocol_override?.reasoning ?? pi_template?.reasoning === true;
  const thinking_level_map = protocol_override?.thinking_level_map ?? pi_template?.thinkingLevelMap;
  const compat = protocol_override?.compat ?? pi_template?.compat;
  const available_thinking_levels = resolve_available_thinking_levels(
    model.api_format,
    reasoning,
    thinking_level_map,
    compat,
  );
  const context_window =
    app_override?.capacity?.context_window ??
    maximum_positive_integer(matches.map((catalog_model) => catalog_model.contextWindow));
  const max_tokens =
    app_override?.capacity?.max_tokens ??
    maximum_positive_integer(matches.map((catalog_model) => catalog_model.maxTokens));
  const automatic_agent_limits = resolve_automatic_agent_limits(context_window, max_tokens);
  const agent = resolve_agent_limits(model.agent, automatic_agent_limits);
  return {
    agent_config: agent.config,
    agent_limits: agent.limits,
    available_thinking_levels,
    context_window,
    max_tokens,
    reasoning,
    ...(thinking_level_map === undefined ? {} : { thinking_level_map }),
    ...(compat === undefined ? {} : { compat }),
  };
}

/** 精确项优先；否则取配置 ID 中具有分隔边界的最长且唯一 canonical ID。 */
export function match_pi_catalog_models(
  configured_id: string,
  catalog: readonly PiCatalogModel[],
): PiCatalogModel[] {
  const canonical_id = match_canonical_model_id(
    configured_id,
    catalog.map((model) => model.id),
  );
  return catalog.filter((model) => model.id.toLowerCase() === canonical_id);
}

/** 配置归一化时修正失效档位；请求阶段不再隐式升降档。 */
export function adjust_model_thinking_level(
  current_level: ModelThinkingLevel,
  available_levels: readonly ModelThinkingLevel[],
): ModelThinkingLevel {
  if (available_levels.includes(current_level)) return current_level;
  const requested_index = MODEL_THINKING_LEVELS.indexOf(current_level);
  for (let index = requested_index - 1; index > 0; index -= 1) {
    const candidate = MODEL_THINKING_LEVELS[index];
    if (candidate !== undefined && available_levels.includes(candidate)) return candidate;
  }
  return available_levels.find((level) => level !== "OFF") ?? "OFF";
}

/** 只把可用且被产品暴露的档位投影为 Pi 值。 */
export function resolve_pi_thinking_level(
  level: ModelThinkingLevel,
  available_levels: readonly ModelThinkingLevel[],
): PiModelThinkingLevel {
  return available_levels.includes(level) ? PRODUCT_TO_PI_LEVEL[level] : "off";
}

/** 模型修正先按名称定位，容量和协议能力在各自消费边界读取。 */
function match_model_capability_override(configured_id: string): ModelCapabilityOverride | null {
  const canonical_id = match_canonical_model_id(
    configured_id,
    MODEL_CAPABILITY_OVERRIDES.map((override) => override.model_id),
  );
  return (
    MODEL_CAPABILITY_OVERRIDES.find(
      (override) => override.model_id.toLowerCase() === canonical_id,
    ) ?? null
  );
}

/** 两种事实来源共用名称选择规则；重复目录记录保留给调用方聚合。 */
function match_canonical_model_id(
  configured_id: string,
  model_ids: readonly string[],
): string | null {
  const normalized_id = configured_id.trim().toLowerCase();
  const canonical_ids = model_ids.map((model_id) => model_id.toLowerCase());
  if (canonical_ids.includes(normalized_id)) return normalized_id;
  const candidates = canonical_ids.filter((model_id) =>
    contains_canonical_id(normalized_id, model_id),
  );
  const longest_length = Math.max(0, ...candidates.map((model_id) => model_id.length));
  const longest_ids = new Set(candidates.filter((model_id) => model_id.length === longest_length));
  return longest_ids.size === 1 ? (longest_ids.values().next().value ?? null) : null;
}

/** 只在 canonical ID 的字母数字边界匹配，避免把短模型名误配到更长 ID。 */
function contains_canonical_id(configured_id: string, canonical_id: string): boolean {
  let offset = configured_id.indexOf(canonical_id);
  while (offset >= 0) {
    const before = configured_id[offset - 1];
    const after = configured_id[offset + canonical_id.length];
    if (!is_model_id_word_character(before) && !is_model_id_word_character(after)) return true;
    offset = configured_id.indexOf(canonical_id, offset + 1);
  }
  return false;
}

/** ID 首尾和非字母数字字符都构成模型名匹配边界。 */
function is_model_id_word_character(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9]/u.test(value);
}

/** 从匹配记录中选择当前协议真正能消费的一条思考模板。 */
function select_pi_thinking_template(
  api_format: ModelApiFormat,
  matches: readonly PiCatalogModel[],
): PiCatalogModel | null {
  const api_order = resolve_pi_api_order(api_format);
  if (api_order.length === 0) return null;
  return (
    [...matches]
      .filter((model) => api_order.includes(model.api))
      .sort((left, right) => {
        const api_delta = api_order.indexOf(left.api) - api_order.indexOf(right.api);
        if (api_delta !== 0) return api_delta;
        return provider_order(left.provider) - provider_order(right.provider);
      })[0] ?? null
  );
}

/** 按产品协议选择 Pi API 形态；同形态再交给供应商优先级决胜。 */
function resolve_pi_api_order(api_format: ModelApiFormat): readonly Api[] {
  if (api_format === "Google") return ["google-generative-ai"];
  if (api_format === "Anthropic") return ["anthropic-messages"];
  if (api_format === "OpenAIResponses") {
    return ["openai-responses", "azure-openai-responses", "openai-completions"];
  }
  if (api_format === "OpenAI") return ["openai-completions", "openai-responses"];
  return [];
}

/** 未列入原生供应商表的代理记录统一排在末尾。 */
function provider_order(provider: string): number {
  const index = NATIVE_PROVIDER_ORDER.indexOf(provider as (typeof NATIVE_PROVIDER_ORDER)[number]);
  return index < 0 ? NATIVE_PROVIDER_ORDER.length : index;
}

/** 用 Pi 的公开能力探针投影产品六档；OpenAI 开关型兼容模型只暴露关/低。 */
function resolve_available_thinking_levels(
  api_format: ModelApiFormat,
  reasoning: boolean,
  thinking_level_map: ThinkingLevelMap | undefined,
  compat: PiCatalogModel["compat"] | undefined,
): readonly ModelThinkingLevel[] {
  if (!reasoning || api_format === "SakuraLLM") return [];
  if (
    api_format === "OpenAI" &&
    thinking_level_map === undefined &&
    compat !== undefined &&
    "thinkingFormat" in compat &&
    compat.thinkingFormat !== undefined &&
    compat.supportsReasoningEffort !== true
  ) {
    return ["OFF", "LOW"];
  }
  const probe: PiCatalogModel = {
    id: "capability-probe",
    name: "capability-probe",
    api: "openai-completions",
    provider: "openai-compatible",
    baseUrl: "",
    reasoning,
    ...(thinking_level_map === undefined ? {} : { thinkingLevelMap: thinking_level_map }),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
  };
  const supported = new Set(getSupportedThinkingLevels(probe));
  return MODEL_THINKING_LEVELS.filter((level) => supported.has(PRODUCT_TO_PI_LEVEL[level]));
}

/** 根据已解析的模型容量应用产品的自动输出上限规则。 */
function resolve_automatic_agent_limits(
  context_window: number | null,
  model_max_tokens: number | null,
): ModelAgentLimits {
  if (context_window === null || model_max_tokens === null) return FALLBACK_AGENT_LIMITS;
  const product_max_tokens =
    context_window < LARGE_CONTEXT_WINDOW_THRESHOLD
      ? SMALL_AUTOMATIC_OUTPUT_LIMIT
      : LARGE_AUTOMATIC_OUTPUT_LIMIT;
  return {
    context_window,
    max_output_tokens: Math.min(model_max_tokens, product_max_tokens),
  };
}

/** 过滤 Pi catalog 中无效容量，剩余值按全局能力聚合规则取最大值。 */
function maximum_positive_integer(values: readonly number[]): number | null {
  const valid_values = values.filter((value) => Number.isSafeInteger(value) && value > 0);
  return valid_values.length === 0 ? null : Math.max(...valid_values);
}

/** 合并用户显式 Agent 容量与自动容量，并确保压缩预留始终可用。 */
function resolve_agent_limits(
  value: ModelAgentConfig,
  automatic: ModelAgentLimits,
): { config: ModelAgentConfig; limits: ModelAgentLimits } {
  const parsed_config = normalize_model_agent_config(value).config;
  const context_window =
    parsed_config.context_window === 0 ? automatic.context_window : parsed_config.context_window;
  const requested_max_output_tokens =
    parsed_config.max_output_tokens === 0
      ? automatic.max_output_tokens
      : parsed_config.max_output_tokens;
  const available_output_tokens = context_window - AGENT_COMPACTION_RESERVE_TOKENS;
  if (available_output_tokens <= 0) {
    return { config: { ...DEFAULT_MODEL_AGENT_CONFIG }, limits: automatic };
  }
  const max_output_tokens = Math.min(requested_max_output_tokens, available_output_tokens);
  return {
    config:
      parsed_config.max_output_tokens !== 0 && max_output_tokens !== requested_max_output_tokens
        ? { ...parsed_config, max_output_tokens }
        : parsed_config,
    limits: { context_window, max_output_tokens },
  };
}
