export const AGENT_DOING_TEXT_LIMIT = 64; // 正在处理的内容只表达动作与对象，证据保存在工作文件中

/** 工具参数与公开事件共用文本边界，`null` 表示模型清空正在处理的内容。 */
export function normalize_agent_doing(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError("Doing text must be a string or null.");
  const text = value.trim();
  if (text === "" || text.length > AGENT_DOING_TEXT_LIMIT) {
    throw new TypeError(
      `Doing text must contain 1–${AGENT_DOING_TEXT_LIMIT.toString()} characters.`,
    );
  }
  return text;
}
