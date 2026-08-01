import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import type { JsonRecord } from "../../../domain/json";

/** 项目结果归一与 payload 覆盖使用的稳定 provider 身份。 */
export type RequestProvider = "openai-compatible" | "google" | "anthropic" | "sakura";

/** 模型配置在 policy 边界收窄后的不可变请求事实。 */
export type ModelRequestSnapshot = Readonly<{
  provider: RequestProvider; // 保留产品协议身份，用于结果规则和诊断
  api_format: ModelApiFormat; // 保留供应商协议族，用于 payload 与诊断
  api_keys: readonly string[]; // 当前模型可轮换的凭据集合
  base_url: string; // 按 pi-ai adapter 契约归一后的请求端点
  model_id: string; // 最终写入供应商 payload 的模型名
  headers: Readonly<Record<string, string>>; // 包含 User-Agent 与已启用扩展头的最终模型请求头
  extra_body: Readonly<JsonRecord>; // 已启用的供应商扩展字段
  generation: Readonly<JsonRecord>; // 温度等生成参数快照
  output_token_limit: number; // 统一解析后的输出 token 上限
  thinking_level: ModelThinkingLevel; // 统一思考等级
}>;
