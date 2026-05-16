// 保守模式规则：移除所有常见 ruby 标记，尽量只留下正文
const CONSERVATIVE_RULES: Array<readonly [RegExp, string]> = [
  [/\\r\[(.+?),.+?\]/giu, "$1"], // \r[漢字,かんじ]
  [/\\rb\[(.+?),.+?\]/giu, "$1"], // \rb[漢字,かんじ]
  [/\[r_.+?\]\[ch_(.+?)\]/giu, "$1"], // [r_かんじ][ch_漢字]
  [/\[ch_(.+?)\]/giu, "$1"], // [ch_漢字]
  [/<ruby\s*=\s*.*?>(.*?)<\/ruby>/giu, "$1"], // <ruby = かんじ>漢字</ruby>
  [/<ruby>.*?<rb>(.*?)<\/rb>.*?<\/ruby>/giu, "$1"], // <ruby><rb>漢字</rb><rtc><rt>かんじ</rt></rtc></ruby>
  [/\[ruby text\s*=\s*.*?\]/giu, ""], // [ruby text=かんじ] / [ruby text = "かんじ"]
];

// 激进模式额外规则：移除括号、方括号和竖线格式的 ruby 标记
const AGGRESSIVE_RULES: Array<readonly [RegExp, string]> = [
  [/\((.+)\/.+\)/giu, "$1"], // (漢字/かんじ)
  [/\[(.+)\/.+\]/giu, "$1"], // [漢字/かんじ]
  [/\|(.+?)\[.+?\]/giu, "$1"], // |漢字[かんじ]
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
}
