import { is_hangul_character } from "../../base/language";

// 拟声词谚文：这些字符只有贴在其它韩文旁边时才认为是有效韩文残留。
const RULE_ONOMATOPOEIA = new Set(["뿅", "슝", "쩝", "콕", "끙", "힝"]);

/**
 * 韩语拟声字修复器，移除模型误带出的孤立谚文残留。
 */
export class HangeulFixer {
  /**
   * 只有拟声字前后仍有韩文字符时才保留。
   */
  public static fix(dst: string): string {
    const chars = [...dst];
    const result: string[] = [];
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index] ?? "";
      if (!RULE_ONOMATOPOEIA.has(char)) {
        result.push(char);
        continue;
      }
      const prev_char = chars[index - 1] ?? "";
      const next_char = chars[index + 1] ?? "";
      if (is_hangul_character(prev_char) || is_hangul_character(next_char)) {
        result.push(char);
      }
    }
    return result.join("");
  }
}
