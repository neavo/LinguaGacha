export const AGENT_TODO_ITEM_LIMIT = 4; // 有界阶段导航，防止 Todo 取代领域工作资产
export const AGENT_TODO_TEXT_LIMIT = 64; // 短标签只表达动作与对象，不承载证据或结论

/** 收窄跨进程 Todo，并复制为可由当前状态所有者安全持有的值。 */
export function normalize_agent_todos(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError("Todo must be an array.");
  if (value.length > AGENT_TODO_ITEM_LIMIT) {
    throw new TypeError(`Todo cannot contain more than ${AGENT_TODO_ITEM_LIMIT.toString()} items.`);
  }
  return value.map((item) => {
    if (typeof item !== "string") throw new TypeError("Each Todo item must be a string.");
    const normalized = item.trim();
    if (normalized === "") throw new TypeError("Todo items cannot be empty.");
    if (normalized.length > AGENT_TODO_TEXT_LIMIT) {
      throw new TypeError(
        `Todo items cannot exceed ${AGENT_TODO_TEXT_LIMIT.toString()} characters.`,
      );
    }
    return normalized;
  });
}
