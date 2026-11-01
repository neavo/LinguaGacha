export type RenpyBoundary = { index: number; value: string };

/** 按插值深度、引号与字面转义识别边界，供缺少引擎身份的文本推断格式。 */
export function scan_renpy_boundaries(text: string): RenpyBoundary[] {
  const result: RenpyBoundary[] = [];
  for (let at = 0; at < text.length; at++) {
    const open = text[at];
    if (open !== "[" && open !== "{") continue;
    const start = at;
    if (text[at + 1] === open) {
      result.push({ index: start, value: open + open });
      at++;
      continue;
    }
    if (open === "{") {
      const end = text.indexOf("}", at + 1);
      if (end < 0 || text.slice(at + 1, end).includes("{")) continue;
      result.push({ index: start, value: text.slice(start, end + 1) });
      at = end;
      continue;
    }
    let depth = 1; // 只统计字符串和圆括号外的方括号深度。
    let quote = ""; // 字符串内的括号不参与边界判断。
    let parentheses = 0; // 调用参数内的右方括号不能结束外层插值。
    let end = at + 1;
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) {
        if (char === "\\") end++;
        else if (char === quote) quote = "";
      } else if (char === "'" || char === '"') quote = char;
      else if (char === "(") parentheses++;
      else if (char === ")" && parentheses > 0) parentheses--;
      else if (parentheses === 0) {
        if (char === "[") depth++;
        else if (char === "]" && --depth === 0) break;
      }
    }
    if (depth === 0) {
      result.push({ index: start, value: text.slice(start, end + 1) });
      at = end;
    }
  }
  return result;
}
