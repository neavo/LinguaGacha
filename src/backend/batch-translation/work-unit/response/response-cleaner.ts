const WHY_TAG_PATTERN = /<why>(.*?)<\/why>/gis; // 翻译响应中的规则推理块

export class ResponseCleaner {
  /** 检查翻译增强模式的规则推理块，并复位全局正则游标。 */
  public static has_rule_analysis_block(response_result: string): boolean {
    WHY_TAG_PATTERN.lastIndex = 0;
    const result = WHY_TAG_PATTERN.test(response_result);
    WHY_TAG_PATTERN.lastIndex = 0;
    return result;
  }

  /** 拆出规则推理供日志展示，剩余正文交给翻译解码器。 */
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
