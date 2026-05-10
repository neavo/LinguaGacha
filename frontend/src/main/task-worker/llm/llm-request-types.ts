import type { ApiJsonValue } from "../../api/api-types";

/**
 * LLM 请求消息保持 OpenAI chat 形状，Python adapter 再按供应商转换。
 */
export interface LlmRequestMessage {
  // role 是供应商 SDK 的稳定分流键，worker 不在这里解释供应商差异。
  role: string;
  // content 是已经拼好的提示词文本，不能再在 Python 侧拼业务数据。
  content: string;
}

/**
 * TS worker 调 Python LLM adapter 的唯一请求壳。
 */
export interface PyLlmRequestBody {
  // run_id / work_unit_id 只用于诊断与迟到结果隔离，不代表 Python 持有任务状态。
  run_id: string;
  work_unit_id: string;
  // model 保留原始配置快照形状，避免 TS worker 绑定具体供应商字段。
  model: ApiJsonValue;
  // config_snapshot 与任务启动时一致，确保重试不会读到后续 UI 修改。
  config_snapshot: ApiJsonValue;
  // messages 已经由 PromptBuilder 拼好，Python adapter 只负责供应商协议转换。
  messages: LlmRequestMessage[];
  // request_options 预留给低频调用覆盖超时等传输参数，不承载业务状态。
  request_options?: Record<string, ApiJsonValue>;
}

/**
 * Python adapter 只返回真实请求事实，不返回业务 item 或解析后的候选。
 */
export interface PyLlmRequestResult {
  // response_think 只用于日志展示和分析，不参与译文解析。
  response_think: string;
  // response_result 是 worker 后处理的唯一模型正文输入。
  response_result: string;
  // token 计数用于任务统计，缺失时由客户端归零。
  input_tokens: number;
  output_tokens: number;
  // 以下布尔标记保留 Python adapter 的请求事实，TaskEngine 决定如何重试或降级。
  cancelled: boolean;
  timeout: boolean;
  degraded: boolean;
  // error 保留供应商侧错误文本，空字符串表示没有可展示错误。
  error: string;
}
