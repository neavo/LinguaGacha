import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import type { JsonRecord } from "../../../domain/json";

export type RequestProvider = "openai-compatible" | "google" | "anthropic" | "sakura";

/**
 * 模型配置在 policy 边界收窄后的不可变请求事实。
 */
export interface ModelRequestSnapshot {
  provider: RequestProvider; // 决定 official SDK transport
  api_format: ModelApiFormat; // 保留供应商协议族，用于 payload 与诊断
  api_keys: string[]; // 当前模型可轮换的凭据集合
  base_url: string; // policy 归一后的 SDK 端点
  model_id: string; // 最终写入供应商 payload 的模型名
  headers: Record<string, string>; // 包含 User-Agent 与已启用扩展头的最终模型请求头
  extra_body: JsonRecord; // 已启用的供应商扩展字段
  generation: JsonRecord; // 温度等生成参数快照
  output_token_limit: number; // 统一解析后的输出 token 上限
  thinking_level: ModelThinkingLevel; // 统一思考等级
}

/**
 * transport 只消费最终策略，不再读取原始模型或应用设置。
 */
export interface ResolvedRequestPolicy {
  provider: RequestProvider; // 决定 official SDK transport，不能再由 transport 二次推断
  api_format: ModelApiFormat; // 用于 provider 错误诊断和 client 隔离
  base_url: string; // 已归一的 SDK 端点
  headers: Record<string, string>; // 已归一的附加请求头
  api_keys: string[]; // limiter 发起请求时选择的凭据集合
  payload: Record<string, unknown>; // transport 可直接交给 SDK 的最终载荷
  timeout_ms: number; // 单次请求超时
}
