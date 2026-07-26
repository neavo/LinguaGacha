import { is_kana_character } from "../../domain/language";

// 拟声词小假名：这些字符只有贴在其它假名旁边时才认为是有效日文残留
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
 * 日文拟声小假名修复器，移除模型误带出的孤立假名残留
 */
export class KanaFixer {
  /**
   * 只有小假名前后仍有日文假名时才保留，保持旧修复口径
   */
  public static fix(dst: string): string {
    const chars = [...dst];
    return chars
      .filter(
        (char, index) =>
          !RULE_ONOMATOPOEIA.has(char) ||
          is_kana_character(chars[index - 1] ?? "") ||
          is_kana_character(chars[index + 1] ?? ""),
      )
      .join("");
  }
}
