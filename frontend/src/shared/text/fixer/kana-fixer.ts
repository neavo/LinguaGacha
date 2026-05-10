import { is_kana_character } from "../../rules/languages";

// 拟声词小假名：这些字符只有贴在其它假名旁边时才认为是有效日文残留。
const RULE_ONOMATOPOEIA = new Set([
  "ッ",
  "っ",
  "ぁ",
  "ぃ",
  "ぅ",
  "ぇ",
  "ぉ",
  "ゃ",
  "ゅ",
  "ょ",
  "ゎ",
]);

/**
 * 日语拟声小假名修复器，移除模型误带出的孤立假名残留。
 */
export class KanaFixer {
  /**
   * 只有小假名前后仍有日文假名时才保留，保持 Python 旧修复口径。
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
      if (is_kana_character(prev_char) || is_kana_character(next_char)) {
        result.push(char);
      }
    }
    return result.join("");
  }
}
