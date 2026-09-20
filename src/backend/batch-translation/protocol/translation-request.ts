import type { LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";

export interface TranslationRequestPort {
  /** 一个逻辑请求在调度器内跨密钥恢复，最终返回响应或取消事实。 */
  request(body: LLMRequestBody, signal: AbortSignal): Promise<LLMRequestResult>;
}
