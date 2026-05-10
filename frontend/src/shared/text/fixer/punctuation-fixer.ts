import { is_cjk_language_code } from "../../rules/languages";

// 数量匹配规则 A：以 CJK/全角风格为目标，修复模型把源文符号改成半角或相邻样式的情况。
const RULE_SAME_COUNT_A: Record<string, readonly string[]> = {
  "　": [" "], // 全角空格和半角空格之间的转换。
  "：": [":"],
  "・": ["·"],
  "？": ["?"],
  "！": ["!"],
  "\u2014": ["\u002d", "\u2015"], // 破折号互转：\u002d = -，\u2014 = —，\u2015 = ―。
  "\u2015": ["\u002d", "\u2014"], // 破折号互转：\u002d = -，\u2014 = —，\u2015 = ―。
  "<": ["＜", "《"],
  ">": ["＞", "》"],
  "＜": ["<", "《"],
  "＞": [">", "》"],
  "[": ["【"],
  "]": ["】"],
  "【": ["["],
  "】": ["]"],
  "(": ["（"],
  ")": ["）"],
  "（": ["("],
  "）": [")"],
  "「": ["‘", "“", "『"],
  "」": ["’", "”", "』"],
  "『": ["‘", "“", "「"],
  "』": ["’", "”", "」"],
  "‘": ["“", "「", "『"],
  "’": ["”", "」", "』"],
  "“": ["‘", "「", "『"],
  "”": ["’", "」", "』"],
};

// 数量匹配规则 B：以半角/非 CJK 风格为目标，补齐与规则 A 相反方向的可逆替换。
const RULE_SAME_COUNT_B: Record<string, readonly string[]> = {
  " ": ["　"], // 全角空格和半角空格之间的转换。
  ":": ["："],
  "·": ["・"],
  "?": ["？"],
  "!": ["！"],
  "\u002d": ["\u2014", "\u2015"], // 破折号互转：\u002d = -，\u2014 = —，\u2015 = ―。
};

// 强制替换规则：译文语言为 CJK 时，把日式钩括号统一成中文弯引号。
const RULE_FORCE_CJK: Record<string, readonly string[]> = {
  "「": ["“"],
  "」": ["”"],
};

/**
 * 标点修复器，按源文数量恢复容易互转的全角/半角与引号。
 */
export class PunctuationFixer {
  /**
   * 先修首尾引号，再按语言组合决定应用哪些数量修复规则。
   */
  public static fix(
    src: string,
    dst: string,
    source_language: string,
    target_language: string,
  ): string {
    let result = this.fix_start_end(src, dst, target_language);
    result = this.apply_fix_rules(src, result, RULE_SAME_COUNT_A);
    if (!(is_cjk_language_code(target_language) && !is_cjk_language_code(source_language))) {
      result = this.apply_fix_rules(src, result, RULE_SAME_COUNT_B);
    }
    if (is_cjk_language_code(target_language)) {
      for (const [key, values] of Object.entries(RULE_FORCE_CJK)) {
        result = this.apply_replace_rules(result, key, values);
      }
    }
    return result;
  }

  /**
   * 数量检查沿用 历史口径：源文目标符号数量可由译文目标+错误符号数量解释时才修。
   */
  private static check(src: string, dst: string, key: string, values: readonly string[]): boolean {
    const num_s_x = this.count(src, key);
    const num_s_y = values.reduce((total, value) => total + this.count(src, value), 0);
    const num_t_x = this.count(dst, key);
    const num_t_y = values.reduce((total, value) => total + this.count(dst, value), 0);
    return num_s_x > 0 && num_s_x !== num_s_y && num_s_x > num_t_x && num_s_x === num_t_x + num_t_y;
  }

  /**
   * 顺序应用修复规则，后续规则可继续基于前一轮结果判断。
   */
  private static apply_fix_rules(
    src: string,
    dst: string,
    rules: Record<string, readonly string[]>,
  ): string {
    let result = dst;
    for (const [key, values] of Object.entries(rules)) {
      if (this.check(src, result, key, values)) {
        result = this.apply_replace_rules(result, key, values);
      }
    }
    return result;
  }

  /**
   * 将一组易错符号全部替换为源文目标符号。
   */
  private static apply_replace_rules(dst: string, key: string, values: readonly string[]): string {
    let result = dst;
    for (const value of values) {
      result = result.split(value).join(key);
    }
    return result;
  }

  /**
   * 首尾引号优先按源文形态恢复，减少模型自动改写引号风格。
   */
  private static fix_start_end(src: string, dst: string, target_language: string): string {
    let result = dst;
    if (/^['"‘“「『]/u.test(result)) {
      if (/^[「『]/u.test(src)) {
        result = `${src[0] ?? ""}${result.slice(1)}`;
      } else if (is_cjk_language_code(target_language) && /^[‘“]/u.test(src)) {
        result = `${src[0] ?? ""}${result.slice(1)}`;
      }
    }
    if (/['"’”」』]$/u.test(result)) {
      if (/[」』]$/u.test(src)) {
        result = `${result.slice(0, -1)}${src.at(-1) ?? ""}`;
      } else if (is_cjk_language_code(target_language) && /[’”]$/u.test(src)) {
        result = `${result.slice(0, -1)}${src.at(-1) ?? ""}`;
      }
    }
    return result;
  }

  /**
   * 字符串计数使用 split，避免正则转义遗漏特殊符号。
   */
  private static count(text: string, token: string): number {
    return token === "" ? 0 : text.split(token).length - 1;
  }
}
