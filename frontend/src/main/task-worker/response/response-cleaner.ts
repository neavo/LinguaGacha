// 结构化思考块识别规则：翻译和分析都可能要求模型先输出 <why>...</why>。
const WHY_TAG_PATTERN = /<why>(.*?)<\/why>/gis;

/**
 * 模型响应清洗器，负责剥离 `<why>` 与压缩日志空行。
 */
export class ResponseCleaner {
  /**
   * 是否存在 why 块用于分析链路判断“无术语但有解释”的合法失败。
   */
  public static has_why_block(response_result: string): boolean {
    WHY_TAG_PATTERN.lastIndex = 0;
    const result = WHY_TAG_PATTERN.test(response_result);
    WHY_TAG_PATTERN.lastIndex = 0;
    return result;
  }

  /**
   * 从模型正文中剥离 `<why>...</why>`，避免 JSONLINE 解码被污染。
   */
  public static extract_why_from_response(response_result: string): {
    cleaned_response_result: string;
    why_text: string;
  } {
    if (response_result === "") {
      return { cleaned_response_result: response_result, why_text: "" };
    }
    const matches = [...response_result.matchAll(WHY_TAG_PATTERN)];
    WHY_TAG_PATTERN.lastIndex = 0;
    if (matches.length === 0) {
      return { cleaned_response_result: response_result, why_text: "" };
    }
    const why_text = matches
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean)
      .join("\n");
    return {
      cleaned_response_result: response_result.replace(WHY_TAG_PATTERN, ""),
      why_text,
    };
  }

  /**
   * 连续空行压缩成单个空行，保持日志可读。
   */
  public static normalize_blank_lines(text: string): string {
    if (text === "") {
      return text;
    }
    const normalized: string[] = [];
    let prev_empty = false;
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim() === "") {
        if (!prev_empty) {
          normalized.push("");
        }
        prev_empty = true;
        continue;
      }
      normalized.push(line);
      prev_empty = false;
    }
    return normalized.join("\n");
  }

  /**
   * 把两段可选文本按块拼接，调用方不用重复判断空字符串。
   */
  public static merge_text_blocks(first_text: string, second_text: string): string {
    return [first_text, second_text].filter((text) => text !== "").join("\n");
  }
}
