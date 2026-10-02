import type { Model, Api, AssistantMessage } from "@earendil-works/pi-ai";
import {
  calculateContextTokens,
  estimateMessageTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import type { ContextView } from "@earendil-works/pi-durable";
import type { AgentContextSnapshot } from "../../shared/agent";

export const AGENT_KEEP_RECENT_TOKENS = 32_000;

/** 条目身份决定用量是否覆盖当前前缀。时间戳相同的摘要与响应也不会误用旧用量。 */
export function read_agent_session_context(
  view: ContextView,
  model: Model<Api> | null,
): AgentContextSnapshot {
  const boundary = Math.max(
    view.head?.id ?? 0,
    ...view.entries.filter((entry) => entry.edits !== undefined).map((entry) => entry.id),
  );
  let measured: AssistantMessage | undefined;
  for (let i = view.entries.length - 1; i >= 0 && measured === undefined; i--) {
    if (view.entries[i]!.id <= boundary) continue;
    measured = view.contributions[i]?.findLast(
      (message): message is AssistantMessage =>
        message.role === "assistant" && calculateContextTokens(message.usage) > 0,
    );
  }
  const from = measured === undefined ? 0 : view.messages.lastIndexOf(measured) + 1;
  const tokens =
    (measured === undefined ? 0 : calculateContextTokens(measured.usage)) +
    view.messages.slice(from).reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  const tail = Math.max(0, ...view.entries.map((entry) => entry.id));
  return {
    tokens,
    compactable: tokens > AGENT_KEEP_RECENT_TOKENS && tail !== view.head?.id,
    limits:
      model === null
        ? null
        : { context_window: model.contextWindow, max_output_tokens: model.maxTokens },
  };
}
