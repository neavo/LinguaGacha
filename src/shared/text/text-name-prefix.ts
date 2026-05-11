// 姓名前缀兼容半角方括号和全角书名号，保持旧注入格式可逆。
export const TEXT_NAME_PREFIX_PATTERN = /^[\u005b【](.*?)[\u005d】]\s*/iu;

/**
 * 将源姓名注入第一行文本，让模型在同一次请求里产出姓名译文。
 */
export function inject_text_name_prefix(srcs: string[], first_name_src: string | null): string[] {
  if (first_name_src === null || first_name_src === "" || srcs.length === 0) {
    return srcs;
  }
  const injected = [...srcs];
  injected[0] = `【${first_name_src}】${injected[0] ?? ""}`;
  return injected;
}

/**
 * 从模型返回的首行译文里提取姓名前缀，并返回去掉前缀后的正文。
 */
export function extract_text_name_prefix(text: string): { name: string | null; text: string } {
  const match = TEXT_NAME_PREFIX_PATTERN.exec(text);
  if (match === null) {
    return { name: null, text };
  }
  return {
    name: match[1] ?? "",
    text: text.replace(TEXT_NAME_PREFIX_PATTERN, ""),
  };
}
