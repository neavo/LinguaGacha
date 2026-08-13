import { normalize_agent_user_message_text } from "@shared/agent";

/** Agent 输入历史属于 renderer 全局 UI 缓存，不按工程或后端会话分区。 */
export const AGENT_INPUT_HISTORY_STORAGE_KEY = "lg-agent-input-history";
/** 有界历史避免辅助缓存随长期使用无限增长。 */
export const AGENT_INPUT_HISTORY_LIMIT = 20;

/** 输入历史只保留规范正文的最近使用位置，供读取与写入共享同一不变量。 */
function apply_agent_input_history_text(current: readonly string[], text: string): string[] {
  return [...current.filter((message) => message !== text), text].slice(-AGENT_INPUT_HISTORY_LIMIT);
}

/** 输入历史持久化失败只降级辅助 UI，不改变调用方已经接受的新内存值。 */
function persist_agent_input_history(storage: Storage, next: string[]): string[] {
  try {
    storage.setItem(AGENT_INPUT_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 后端提交已经成功，辅助存储不得反向改变主链路结果。
  }
  return next;
}

/** 从 renderer 私有存储读取纯文本历史；任一条非法即放弃整份载荷。 */
export function read_agent_input_history(storage: Storage): string[] {
  try {
    const raw = storage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY);
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    let history: string[] = [];
    for (const message of value) {
      const text = normalize_agent_user_message_text(message);
      if (text === null || text !== message) return [];
      history = apply_agent_input_history_text(history, text);
    }
    return history;
  } catch {
    // 存储或 JSON 失败只关闭辅助历史，不影响编辑器和后端提交主链路。
    return [];
  }
}

/** 更新后端已受理消息的最近位置，并让存储失败只降级持久化。 */
export function update_agent_input_history(
  storage: Storage,
  current: readonly string[],
  text: string,
): string[] {
  const next = apply_agent_input_history_text(current, text);
  return persist_agent_input_history(storage, next);
}

/** 修改已受理 user 消息时删除旧正文，再按普通受理规则写入新正文。 */
export function replace_agent_input_history(
  storage: Storage,
  current: readonly string[],
  previous: string,
  next_text: string,
): string[] {
  const without_previous = current.filter((message) => message !== previous);
  const next =
    normalize_agent_user_message_text(next_text) === null
      ? without_previous
      : apply_agent_input_history_text(without_previous, next_text);
  return persist_agent_input_history(storage, next);
}
