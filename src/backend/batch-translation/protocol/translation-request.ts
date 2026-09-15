import type { LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";

/** Key 耗尽是翻译运行态结果，通用 LLMClient 只返回单次请求事实。 */
export type TranslationRequestResult = LLMRequestResult & { keys_exhausted?: true };

export interface TranslationRequestPort {
  /** 一个逻辑请求可跨 Key 恢复，最终返回响应、取消或 Key 耗尽事实。 */
  request(body: LLMRequestBody, signal: AbortSignal): Promise<TranslationRequestResult>;
}
