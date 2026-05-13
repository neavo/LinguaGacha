import type { ModelRequestSnapshot } from "./policy-types";
import type { LLMMessage } from "../llm-types";
import { build_openai_compatible_payload } from "./openai-compatible-policy";

/**
 * SakuraLLM 使用 OpenAI-compatible 请求协议，但响应由 SakuraTransport 转逐行 JSON map。
 */
export function build_sakura_payload(
  snapshot: ModelRequestSnapshot,
  messages: LLMMessage[],
): Record<string, unknown> {
  return build_openai_compatible_payload(snapshot, messages);
}
