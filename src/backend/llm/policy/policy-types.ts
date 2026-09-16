import type { ModelApiFormat, ModelThinkingLevel } from "../../../domain/model";
import type { JsonRecord } from "../../../domain/json";

/** 调用入口提供身份；会话生命周期由 Agent runtime 或 OneShot 任务拥有。 */
export type ModelRequestIdentity = Readonly<{
  user_agent: string;
  session_id: string;
}>;

/** 模型配置在 policy 边界收窄后的不可变请求事实。 */
export type ModelRequestSnapshot = Readonly<{
  api_format: ModelApiFormat; // 供应商协议族，用于 adapter、payload、结果规则与诊断
  api_keys: readonly string[]; // 当前模型可轮换的凭据集合
  base_url: string; // 按 pi-ai adapter 契约归一后的请求端点
  model_id: string; // 最终写入供应商 payload 的模型名
  headers: Readonly<Record<string, string>>; // 仅在 adapter 调用选项中发送的应用身份与扩展头
  extra_body: Readonly<JsonRecord>; // 已启用的供应商扩展字段
  generation: Readonly<JsonRecord>; // 温度等生成参数快照
  output_token_limit: number; // 统一解析后的输出 token 上限
  thinking_level: ModelThinkingLevel; // 统一思考等级
}>;
