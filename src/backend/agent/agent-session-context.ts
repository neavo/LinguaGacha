import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { estimateTokens, type AgentSession } from "@earendil-works/pi-coding-agent";

import type { AgentContextSnapshot } from "../../shared/agent";

export const AGENT_KEEP_RECENT_TOKENS = 32_000; // 产品固定保留的最近模型可见历史

/** 上下文只读取 SDK 规范历史；压缩后尚无有效 usage 时按当前内容估算。 */
export function read_agent_session_context(session: AgentSession): AgentContextSnapshot {
  let tokens = session.getContextUsage()?.tokens;
  if (tokens === null || tokens === undefined) {
    const { messages } = session.sessionManager.buildSessionContext();
    const system = getCurrentSystemMessage(messages);
    tokens = system === undefined ? 0 : estimateTokens(system);
    for (const message of messages) {
      if (message.role !== "system") tokens += estimateTokens(message);
    }
  }
  const model = session.model;
  // SDK 拒绝在刚完成压缩的同一历史边界再次压缩。
  const last_entry = session.sessionManager.getBranch().at(-1);
  return {
    tokens,
    limits:
      model === undefined
        ? null
        : { context_window: model.contextWindow, max_output_tokens: model.maxTokens },
    compactable: tokens > AGENT_KEEP_RECENT_TOKENS && last_entry?.type !== "compaction",
  };
}
