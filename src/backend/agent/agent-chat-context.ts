import type { Model, Api, AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  calculateContextTokens,
  estimateMessageTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import type { ContextView } from "@earendil-works/pi-durable";
import type { AgentContextSnapshot } from "../../shared/agent";

export const AGENT_KEEP_RECENT_TOKENS = 32_000;

/** 条目身份决定用量是否覆盖当前前缀。时间戳相同的摘要与响应也不会误用旧用量。 */
export function read_agent_chat_context(
  view: ContextView,
  model: Model<Api> | null,
): AgentContextSnapshot {
  const measured = read_measured_message(view);
  const from = measured === undefined ? 0 : view.messages.lastIndexOf(measured) + 1;
  const tokens =
    (measured === undefined ? 0 : calculateContextTokens(measured.usage)) +
    estimate_agent_messages(view.messages.slice(from));
  const tail = Math.max(0, ...view.entries.map((entry) => entry.id));
  return {
    tokens,
    compactable:
      estimate_agent_messages(view.messages) > AGENT_KEEP_RECENT_TOKENS && tail !== view.head?.id,
    limits:
      model === null
        ? null
        : { context_window: model.contextWindow, max_output_tokens: model.maxTokens },
  };
}

/** SDK 的消息估算同时用于上下文回退和可压缩判断，避免两套估算公式。 */
function estimate_agent_messages(messages: readonly Message[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

/** 后续编辑只有触及已计量前缀才使 usage 失效，时间戳相同也依靠条目身份判断。 */
function read_measured_message(view: ContextView): AssistantMessage | undefined {
  const boundary = view.head?.id ?? 0;
  let firstEdited = Number.POSITIVE_INFINITY; // 后续编辑触及的最早身份，其后的响应覆盖了失效前缀
  for (let i = view.entries.length - 1; i >= 0; i--) {
    const entry = view.entries[i]!;
    // 倒序累计编辑目标，单次扫描排除失效响应，较早且未覆盖编辑目标的响应仍可使用。
    for (const edit of entry.edits ?? []) firstEdited = Math.min(firstEdited, edit.target);
    if (entry.id <= boundary || entry.id >= firstEdited) continue;
    const message = view.contributions[i]?.findLast(
      (message): message is AssistantMessage =>
        message.role === "assistant" && calculateContextTokens(message.usage) > 0,
    );
    if (message !== undefined) return message;
  }
  return undefined;
}
