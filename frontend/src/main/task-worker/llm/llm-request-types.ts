import type { ApiJsonValue } from "../../api/api-types";

/**
 * LLM 请求消息保持 chat 形状，TS adapter 再按供应商转换。
 */
export interface LlmRequestMessage {
  // role 是提示词边界的稳定分流键，worker 不在这里解释供应商差异。
  role: string;
  // content 是已经拼好的提示词文本，LLM adapter 不再拼业务数据。
  content: string;
}

/**
 * TS worker 调 LLM adapter 的唯一请求壳。
 */
export interface LlmRequestBody {
  // run_id / work_unit_id 只用于诊断与迟到结果隔离，不代表 adapter 持有任务状态。
  run_id: string;
  work_unit_id: string;
  // model 保留原始配置快照形状，避免业务 runner 绑定具体供应商字段。
  model: ApiJsonValue;
  // config_snapshot 与任务启动时一致，确保重试不会读到后续 UI 修改。
  config_snapshot: ApiJsonValue;
  // messages 已经由 PromptBuilder 拼好，adapter 只负责供应商协议转换。
  messages: LlmRequestMessage[];
  // request_options 预留给低频调用覆盖超时等传输参数，不承载业务状态。
  request_options?: Record<string, ApiJsonValue>;
}

/**
 * LLM adapter 只返回真实请求事实，不返回业务 item 或解析后的候选。
 */
export interface LlmRequestResult {
  // response_think 只用于日志展示和分析，不参与译文解析。
  response_think: string;
  // response_result 是 worker 后处理的唯一模型正文输入。
  response_result: string;
  // token 计数用于任务统计，缺失时由客户端归零。
  input_tokens: number;
  output_tokens: number;
  // 以下布尔标记保留 LLM adapter 的请求事实，TaskEngine 决定如何重试或降级。
  cancelled: boolean;
  timeout: boolean;
  degraded: boolean;
  // error 保留供应商侧错误文本，空字符串表示没有可展示错误。
  error: string;
}

/**
 * Work unit 只依赖这个中性端口，真实实现可以是 pi-ai 或测试桩。
 */
export interface LlmRequestClient {
  /**
   * 发送一次 LLM 请求并返回原始请求事实。
   */
  request(body: LlmRequestBody, signal: AbortSignal): Promise<LlmRequestResult>;
}
