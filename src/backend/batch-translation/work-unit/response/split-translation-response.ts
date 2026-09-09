const WHY_OPEN_PATTERN = /^\s*<why>/i;
const WHY_CLOSE_PATTERN = /<\/why>/i;

/** 仅分离普通翻译响应开头的分析块，正文中的同名标签属于译文。 */
export function split_translation_response(response: string): {
  rule_analysis_text: string;
  translation_text: string;
} {
  const analysis_parts: string[] = [];
  let translation_text = response;
  let opening: RegExpExecArray | null;
  while ((opening = WHY_OPEN_PATTERN.exec(translation_text)) !== null) {
    const remainder = translation_text.slice(opening[0].length);
    const closing = WHY_CLOSE_PATTERN.exec(remainder);
    if (closing === null) {
      // 未闭合分析中的候选 JSON 不能作为译文提交，交由既有无效响应流程处理。
      analysis_parts.push(remainder.trim());
      translation_text = "";
      break;
    }
    analysis_parts.push(remainder.slice(0, closing.index).trim());
    translation_text = remainder.slice(closing.index + closing[0].length);
  }
  return {
    rule_analysis_text: analysis_parts.filter(Boolean).join("\n"),
    translation_text,
  };
}
