const WHY_TAG_PATTERN = /<why>(.*?)<\/why>/gis; // 规则分析块识别规则：翻译和分析都可能要求模型先输出 <why>...</why>

/**
 * 模型响应清洗器，负责剥离 `<why>` 规则分析块与压缩日志空行
 */
export class ResponseCleaner {
  /**
   * 是否存在规则分析块用于分析链路判断“无术语但有解释”的合法失败
   */
  public static has_rule_analysis_block(response_result: string): boolean {
    WHY_TAG_PATTERN.lastIndex = 0;
    const result = WHY_TAG_PATTERN.test(response_result);
    WHY_TAG_PATTERN.lastIndex = 0;
    return result;
  }

  /**
   * 从模型正文中剥离 `<why>...</why>` 规则分析块，避免 JSONLINE 解码被污染
   */
  public static extract_rule_analysis_from_response(response_result: string): {
    cleaned_response_result: string;
    rule_analysis_text: string;
  } {
    if (response_result === "") {
      return { cleaned_response_result: response_result, rule_analysis_text: "" };
    }
    WHY_TAG_PATTERN.lastIndex = 0;
    const matches = [...response_result.matchAll(WHY_TAG_PATTERN)];
    WHY_TAG_PATTERN.lastIndex = 0;
    if (matches.length === 0) {
      return { cleaned_response_result: response_result, rule_analysis_text: "" };
    }
    const rule_analysis_text = matches
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean)
      .join("\n");
    return {
      cleaned_response_result: response_result.replace(WHY_TAG_PATTERN, ""),
      rule_analysis_text,
    };
  }

  /**
   * 连续空行压缩成单个空行，保持日志可读
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
}
