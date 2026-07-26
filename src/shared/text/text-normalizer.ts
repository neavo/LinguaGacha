const COMPATIBILITY_CHARACTER_PATTERN = /[Ａ-Ｚａ-ｚ０-９ｦ-ﾟ]/u;
const HALFWIDTH_KANA_MARKS: Readonly<Record<string, string>> = {
  ﾞ: "゛",
  ﾟ: "゜",
};

/**
 * 文本处理正规化入口，保持迁移前历史 Normalizer 的可观察语义
 */
export function normalize_text_for_processing(text: string): string {
  return [...text.normalize("NFC")]
    .map(
      (char) =>
        HALFWIDTH_KANA_MARKS[char] ??
        (COMPATIBILITY_CHARACTER_PATTERN.test(char) ? char.normalize("NFKC") : char),
    )
    .join("");
}
