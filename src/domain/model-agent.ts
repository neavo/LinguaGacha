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

/** 新旧模型配置缺省时均保留自动语义，不把当前推导值写回磁盘。 */
export const DEFAULT_MODEL_AGENT_CONFIG: Readonly<ModelAgentConfig> = Object.freeze({
  context_window: 0,
  max_output_tokens: 0,
});

/** 未命中模型规则时使用稳定容量，避免根据未知模型名猜测。 */
const FALLBACK_MODEL_AGENT_LIMITS: ModelAgentLimits = Object.freeze({
  context_window: 256_000,
  max_output_tokens: 32_000,
});

/** 自动容量只识别产品明确支持的模型族，顺序不承担优先级语义。 */
const MODEL_AGENT_LIMIT_RULES = [
  { pattern: /gpt-5\.6/iu, context_window: 353_000, max_output_tokens: 48_000 },
  { pattern: /grok-4\.5/iu, context_window: 500_000, max_output_tokens: 48_000 },
  { pattern: /deepseek-v4/iu, context_window: 500_000, max_output_tokens: 48_000 },
] as const;

/** 读取持久化配置；两个字段都允许用 0 独立表示自动。 */
export function parse_model_agent_config(value: unknown): ModelAgentConfig | null {
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

/** 生效容量必须为正安全整数，且为下一次回复和压缩各保留一份输出预算。 */
export function parse_model_agent_limits(value: unknown): ModelAgentLimits | null {
  const config = parse_model_agent_config(value);
  if (
    config === null ||
    config.context_window === 0 ||
    config.max_output_tokens === 0 ||
    config.max_output_tokens > Math.floor((config.context_window - 1) / 2)
  ) {
    return null;
  }
  return config;
}

/** 缺失或损坏的磁盘配置回到自动，不把某次解析结果固化为用户配置。 */
export function normalize_model_agent_config(value: unknown): ModelAgentConfig {
  return parse_model_agent_config(value) ?? { ...DEFAULT_MODEL_AGENT_CONFIG };
}

/** 只替换配置中为 0 的字段；未知模型稳定回退到产品默认容量。 */
export function resolve_model_agent_limits(
  model_id: string,
  value: unknown,
): ModelAgentLimits | null {
  const config = parse_model_agent_config(value);
  if (config === null) return null;
  const automatic =
    MODEL_AGENT_LIMIT_RULES.find(({ pattern }) => pattern.test(model_id.trim())) ??
    FALLBACK_MODEL_AGENT_LIMITS;
  return parse_model_agent_limits({
    context_window: config.context_window === 0 ? automatic.context_window : config.context_window,
    max_output_tokens:
      config.max_output_tokens === 0 ? automatic.max_output_tokens : config.max_output_tokens,
  });
}
