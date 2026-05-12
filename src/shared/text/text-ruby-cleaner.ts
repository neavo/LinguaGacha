import type { TextTaskItemRecord } from "./text-types";

// 保守模式规则：移除所有常见 ruby 标记，尽量只留下正文
const CONSERVATIVE_RULES: Array<readonly [RegExp, string]> = [
  // \r[漢字,かんじ]
  [/\\r\[(.+?),.+?\]/giu, "$1"],
  // \rb[漢字,かんじ]
  [/\\rb\[(.+?),.+?\]/giu, "$1"],
  // [r_かんじ][ch_漢字]
  [/\[r_.+?\]\[ch_(.+?)\]/giu, "$1"],
  // [ch_漢字]
  [/\[ch_(.+?)\]/giu, "$1"],
  // <ruby = かんじ>漢字</ruby>
  [/<ruby\s*=\s*.*?>(.*?)<\/ruby>/giu, "$1"],
  // <ruby><rb>漢字</rb><rtc><rt>かんじ</rt></rtc></ruby>
  [/<ruby>.*?<rb>(.*?)<\/rb>.*?<\/ruby>/giu, "$1"],
  // [ruby text=かんじ] / [ruby text = "かんじ"]
  [/\[ruby text\s*=\s*.*?\]/giu, ""],
];

// 激进模式额外规则：移除括号、方括号和竖线格式的 ruby 标记
const AGGRESSIVE_RULES: Array<readonly [RegExp, string]> = [
  // (漢字/かんじ)
  [/\((.+)\/.+\)/giu, "$1"],
  // [漢字/かんじ]
  [/\[(.+)\/.+\]/giu, "$1"],
  // |漢字[かんじ]
  [/\|(.+?)\[.+?\]/giu, "$1"],
];

const AGGRESSIVE_EXCLUDED_TYPES = new Set(["WOLF", "RPGMAKER", "RENPY"]); // 这些脚本格式里括号和竖线很可能是控制语法，不能套用激进规则

/**
 * 文本 ruby 标记清理器，负责把常见注音脚手架还原为可翻译正文
 */
export class TextRubyCleaner {
  /**
   * 先应用保守规则，非脚本格式再应用括号类激进规则
   */
  public static clean(text: string, text_type: string): string {
    let result = text;
    for (const [pattern, replacement] of CONSERVATIVE_RULES) {
      result = result.replace(pattern, replacement);
    }
    if (!AGGRESSIVE_EXCLUDED_TYPES.has(text_type)) {
      for (const [pattern, replacement] of AGGRESSIVE_RULES) {
        result = result.replace(pattern, replacement);
      }
    }
    return result;
  }

  /**
   * EPUB AST 已经提供块级清理候选时优先使用候选，保持写回槽位稳定
   */
  public static clean_item_src(item: TextTaskItemRecord, clean_ruby: boolean): string {
    const src = String(item.src ?? "");
    if (!clean_ruby) {
      return src;
    }
    const extra = item.extra_field;
    if (typeof extra === "object" && extra !== null && !Array.isArray(extra)) {
      const epub = extra["epub"];
      if (typeof epub === "object" && epub !== null && !Array.isArray(epub)) {
        const candidate = epub["ruby_clean_candidate"];
        if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
          const cleaned_src = candidate["cleaned_src"];
          if (typeof cleaned_src === "string" && cleaned_src !== "") {
            return cleaned_src;
          }
        }
      }
    }
    return src;
  }
}
