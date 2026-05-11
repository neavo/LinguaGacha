// 转义识别规则：只统计连续反斜杠段，避免把后续控制码内容一起吞掉。
const ESCAPE_PATTERN = /\\+/gu;

/**
 * 转义符修复器，保证译文反斜杠数量和原文同位置对齐。
 */
export class EscapeFixer {
  /**
   * 当源文和译文转义段数量一致时，把译文段逐个替换成源文段。
   */
  public static fix(src: string, dst: string): string {
    // 理论上任务文本不会包含真实换行；若模型输出了换行，按旧口径先还原为 \n 字面量。
    const normalized_dst = dst.replace(/\n/gu, "\\n");
    const src_results = src.match(ESCAPE_PATTERN) ?? [];
    const dst_results = normalized_dst.match(ESCAPE_PATTERN) ?? [];
    if (src_results.join("\u0000") === dst_results.join("\u0000")) {
      return normalized_dst;
    }
    if (src_results.length !== dst_results.length) {
      return normalized_dst;
    }
    let index = 0;
    return normalized_dst.replace(ESCAPE_PATTERN, () => src_results[index++] ?? "");
  }
}
