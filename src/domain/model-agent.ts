import { read_json_record } from "./json";

/** 持久化的 Agent 容量配置；0 表示自动。 */
export type ModelAgentConfig = {
  context_window: number;
  max_output_tokens: number;
};

/** Agent 运行时实际使用的正整数容量。 */
export type ModelAgentLimits = Readonly<{
  context_window: number;
  max_output_tokens: number;
}>;

export type NormalizedModelAgentConfig = Readonly<{
  config: ModelAgentConfig;
  adjusted: boolean;
}>;

/** Agent 自动压缩固定保留的模型上下文容量。 */
export const AGENT_COMPACTION_RESERVE_TOKENS = 32_000;

/** 新旧模型配置缺省时均保留自动语义，不把当前推导值写回磁盘。 */
export const DEFAULT_MODEL_AGENT_CONFIG: Readonly<ModelAgentConfig> = Object.freeze({
  context_window: 0,
  max_output_tokens: 0,
});

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

/**
 * 只规范化持久化字段本身；模型自动容量由后端统一能力解析器拥有。
 * 两项均显式时可立即修复输出超限，无法容纳压缩预留时整组恢复自动。
 */
export function normalize_model_agent_config(value: unknown): NormalizedModelAgentConfig {
  const config = parse_model_agent_config(value);
  if (config === null) {
    return { config: { ...DEFAULT_MODEL_AGENT_CONFIG }, adjusted: true };
  }
  if (config.context_window === 0) {
    return { config, adjusted: false };
  }
  const available_output_tokens = config.context_window - AGENT_COMPACTION_RESERVE_TOKENS;
  if (available_output_tokens <= 0) {
    return { config: { ...DEFAULT_MODEL_AGENT_CONFIG }, adjusted: true };
  }
  if (config.max_output_tokens === 0 || config.max_output_tokens <= available_output_tokens) {
    return { config, adjusted: false };
  }
  return {
    config: { ...config, max_output_tokens: available_output_tokens },
    adjusted: true,
  };
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
