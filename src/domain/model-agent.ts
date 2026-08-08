import { read_json_record } from "./json";

/** 持久化的 Agent 容量配置；0 表示按模型 ID 自动解析。 */
export type ModelAgentConfig = {
  context_window: number;
  max_output_tokens: number;
};

/** Agent 运行时实际使用的正整数容量。 */
export type ModelAgentLimits = Readonly<{
  context_window: number;
  max_output_tokens: number;
}>;

/** 持久化配置规范化结果及其对应的运行时容量。 */
export type ResolvedModelAgentConfig = Readonly<{
  config: ModelAgentConfig;
  limits: ModelAgentLimits;
  adjusted: boolean;
}>;

/** Agent 自动压缩固定保留的模型上下文容量。 */
export const AGENT_COMPACTION_RESERVE_TOKENS = 32_000;

/** 新旧模型配置缺省时均保留自动语义，不把当前推导值写回磁盘。 */
export const DEFAULT_MODEL_AGENT_CONFIG: Readonly<ModelAgentConfig> = Object.freeze({
  context_window: 0,
  max_output_tokens: 0,
});

/**
 * 产品容量预设会随模型规格调整，不构成稳定契约；不要新增逐项断言这些字面值的测试。
 * 测试只覆盖自动解析、用户覆盖和容量合法性等行为。
 */
const FALLBACK_MODEL_AGENT_LIMITS: ModelAgentLimits = Object.freeze({
  context_window: 256_000,
  max_output_tokens: 32_000,
});

/** 自动容量只识别产品明确支持的模型族，顺序不承担优先级语义。 */
const MODEL_AGENT_LIMIT_RULES = [
  { pattern: /gpt-5\.6/iu, context_window: 372_000, max_output_tokens: 32_000 },
  { pattern: /grok-4\.5/iu, context_window: 500_000, max_output_tokens: 64_000 },
  { pattern: /deepseek-v4/iu, context_window: 1_000_000, max_output_tokens: 128_000 },
] as const;

/** 读取持久化配置；两个字段都允许用 0 独立表示自动。 */
function parse_model_agent_config(value: unknown): ModelAgentConfig | null {
  const record = read_json_record(value);
  const context_window = record["context_window"];
  const max_output_tokens = record["max_output_tokens"];
  if (
    typeof context_window !== "number" ||
    !Number.isSafeInteger(context_window) ||
    context_window < 0 ||
    typeof max_output_tokens !== "number" ||
    !Number.isSafeInteger(max_output_tokens) ||
    max_output_tokens < 0
  ) {
    return null;
  }
  return { context_window, max_output_tokens };
}

/** 生效容量必须为正安全整数，且上下文能同时容纳最大输出与固定压缩预留。 */
export function parse_model_agent_limits(value: unknown): ModelAgentLimits | null {
  const config = parse_model_agent_config(value);
  if (
    config === null ||
    config.context_window === 0 ||
    config.max_output_tokens === 0 ||
    config.max_output_tokens > config.context_window - AGENT_COMPACTION_RESERVE_TOKENS
  ) {
    return null;
  }
  return config;
}

/**
 * 统一规范化持久化配置并解析运行时容量。
 * 可修复的超限输出自动收窄；损坏或无法容纳固定预留的配置整组恢复自动。
 */
export function resolve_model_agent_config(
  model_id: string,
  value: unknown,
): ResolvedModelAgentConfig {
  const parsed_config = parse_model_agent_config(value);
  const automatic =
    MODEL_AGENT_LIMIT_RULES.find(({ pattern }) => pattern.test(model_id.trim())) ??
    FALLBACK_MODEL_AGENT_LIMITS;
  const automatic_limits: ModelAgentLimits = {
    context_window: automatic.context_window,
    max_output_tokens: automatic.max_output_tokens,
  };
  if (parsed_config === null) {
    return {
      config: { ...DEFAULT_MODEL_AGENT_CONFIG },
      limits: automatic_limits,
      adjusted: true,
    };
  }

  const context_window =
    parsed_config.context_window === 0 ? automatic.context_window : parsed_config.context_window;
  const requested_max_output_tokens =
    parsed_config.max_output_tokens === 0
      ? automatic.max_output_tokens
      : parsed_config.max_output_tokens;
  const available_output_tokens = context_window - AGENT_COMPACTION_RESERVE_TOKENS;
  if (available_output_tokens <= 0) {
    return {
      config: { ...DEFAULT_MODEL_AGENT_CONFIG },
      limits: automatic_limits,
      adjusted: true,
    };
  }

  const max_output_tokens = Math.min(requested_max_output_tokens, available_output_tokens);
  const adjusted = max_output_tokens !== requested_max_output_tokens;
  return {
    config: adjusted ? { ...parsed_config, max_output_tokens } : parsed_config,
    limits: { context_window, max_output_tokens },
    adjusted,
  };
}
