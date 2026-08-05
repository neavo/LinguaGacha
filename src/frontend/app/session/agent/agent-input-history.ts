import { normalize_agent_user_message_parts, type AgentUserMessagePart } from "@shared/agent";

/** Agent 输入历史属于 renderer 全局 UI 缓存，不按工程或后端会话分区。 */
export const AGENT_INPUT_HISTORY_STORAGE_KEY = "lg-agent-input-history";
/** 有界历史避免辅助缓存随长期使用无限增长。 */
export const AGENT_INPUT_HISTORY_LIMIT = 20;

/** 从 renderer 私有存储读取严格的结构化输入历史；任一条非法即放弃整份载荷。 */
export function read_agent_input_history(storage: Storage): AgentUserMessagePart[][] {
  try {
    const raw = storage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY);
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    const history: AgentUserMessagePart[][] = [];
    for (const message of value) {
      const parts = normalize_agent_user_message_parts(message);
      if (
        parts === null ||
        !parts.some((part) => part.kind === "skill" || part.text.trim() !== "")
      ) {
        return [];
      }
      history.push(parts);
    }
    return history.slice(-AGENT_INPUT_HISTORY_LIMIT);
  } catch {
    // 存储或 JSON 失败只关闭辅助历史，不影响编辑器和后端提交主链路。
    return [];
  }
}

/** 追加后端已受理消息，并让存储失败只降级持久化而不改变当前运行期历史。 */
export function append_agent_input_history(
  storage: Storage,
  current: readonly AgentUserMessagePart[][],
  parts: readonly AgentUserMessagePart[],
): AgentUserMessagePart[][] {
  const snapshot = parts.map((part) => ({ ...part }));
  const next = [...current, snapshot].slice(-AGENT_INPUT_HISTORY_LIMIT);
  try {
    storage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 输入历史是辅助 UI；持久化失败不能反向改变已经成功的后端提交。
  }
  return next;
}
