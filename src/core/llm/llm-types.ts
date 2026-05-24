import type { ApiJsonValue } from "../api/api-types";
import type { ErrorDiagnosticPayload } from "../../shared/error";

/**
 * 请求消息保持标准 chat 形状，policy 再转换为各官方 SDK 的最终 payload。
 */
export interface LLMMessage {
  role: string; // role 是 prompt 与供应商协议的稳定分流键，runner 不解释 provider 差异
  content: string; // content 是已拼好的业务提示词，request policy 不再读取项目事实
}

/**
 * 调用方发送 LLM 请求时使用的唯一请求壳。
 */
export interface LLMRequestBody {
  run_id: string; // run_id / work_unit_id 只用于诊断与迟到结果隔离，不代表 client 持有任务状态
  work_unit_id: string;
  model: ApiJsonValue; // model 保留任务启动快照形状，policy 在边界处收窄供应商字段
  config_snapshot: ApiJsonValue; // config_snapshot 与任务启动时一致，确保重试不读取后续 UI 修改
  messages: LLMMessage[]; // messages 已由 PromptBuilder 拼好，policy 只做协议转换
  request_options?: Record<string, ApiJsonValue>; // request_options 只允许低频传输覆盖，不承载业务状态
}

/**
 * LLM 请求端口只返回真实请求事实，不返回业务 item 或解析后的候选。
 */
export interface LLMRequestResult {
  response_think: string; // response_think 只用于日志展示和分析，不参与译文解析
  response_result: string; // response_result 是调用方后处理的唯一模型正文输入
  input_tokens: number; // token 计数用于任务统计，缺失时由客户端归零
  output_tokens: number;
  cancelled: boolean; // 以下布尔标记保留请求事实，TaskEngine 决定如何重试或降级
  timeout: boolean;
  degraded: boolean;
  failure?: ErrorDiagnosticPayload; // failure 保留供应商或传输异常诊断，缺失表示没有请求级失败
}

/**
 * Work unit 只依赖这个中性端口，真实实现由 official SDK direct transport 承担。
 */
export interface LLMClientPort {
  /**
   * 发送一次 LLM 请求并返回原始请求事实。
   */
  request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult>;
}
