import type { JsonValue } from "../../domain/json";
import type { LogError } from "../../shared/error";

/**
 * 请求消息保持 provider-neutral chat 形状；Pi 负责基础协议转换，项目 policy 固定最终协议语义。
 */
export interface LLMMessage {
  role: "system" | "user"; // OneShot 只接受业务提示词，不承载多轮 assistant 历史
  content: string; // 已拼好的业务提示词，request policy 不再读取项目事实
}

/**
 * 调用方发送 LLM 请求时使用的唯一请求壳。
 */
export interface LLMRequestBody {
  run_id: string; // / work_unit_id 只用于诊断与迟到结果隔离，不代表 client 持有任务状态
  work_unit_id: string;
  model: JsonValue; // 保留任务启动快照形状，policy 在边界处收窄供应商字段
  config_snapshot: JsonValue; // 与任务启动时一致，确保重试不读取后续 UI 修改
  messages: LLMMessage[]; // 已由 PromptBuilder 拼好，policy 只做协议转换
}

/**
 * LLM 请求端口只返回真实请求事实，不返回业务 item 或解析后的候选。
 */
export interface LLMRequestResult {
  response_think: string; // 只用于日志展示和分析，不参与译文解析
  response_result: string; // 正常终态的模型正文，可为空并由消费方按任务协议校验
  input_tokens: number; // token 计数用于任务统计，缺失时由客户端归零
  reasoning_tokens: number; // 供应商报告的思考 token 子集，缺失时归零
  output_tokens: number; // 只表示扣除思考后的输出 token
  cancelled: boolean; // 以下布尔标记保留请求事实，TaskEngine 决定如何重试
  timeout: boolean;
  request_error?: LogError; // 保留供应商或传输异常错误，缺失表示没有请求级失败
}

/**
 * Work unit 只依赖这个中性端口，真实 wire protocol 由 pi-ai 承担。
 */
export interface LLMClientPort {
  /**
   * 发送一次 LLM 请求并返回原始请求事实。
   */
  request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult>;
}
