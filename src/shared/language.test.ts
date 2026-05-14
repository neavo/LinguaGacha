import { describe, expect, it } from "vitest";

import {
  ALL_LANGUAGE_CODE,
  CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE,
  LANGUAGE_DEFINITIONS,
  SOURCE_TARGET_LANGUAGE_CODES,
  all_language_characters,
  has_language_character,
  has_any_hangul_character,
  has_any_hiragana_character,
  has_any_katakana_character,
  has_only_hangul_characters,
  has_only_hiragana_characters,
  has_only_katakana_characters,
  is_cjk_language_code,
  is_hangul_character,
  is_hiragana_character,
  is_katakana_character,
  is_language_character,
  is_kana_character,
  normalize_language_code,
  strip_non_language_characters,
} from "./language";

describe("languages", () => {
  it("以语言定义表作为前端语言代码清单事实源", () => {
    expect(Object.keys(LANGUAGE_DEFINITIONS).sort()).toEqual(
      [ALL_LANGUAGE_CODE, ...SOURCE_TARGET_LANGUAGE_CODES].sort(),
    );
  });

  it("按历史语言规则口径归一化语言代码", () => {
    expect(normalize_language_code("fr")).toBe("FR");
    expect(normalize_language_code(" VI ")).toBe("VI");
    expect(normalize_language_code("unknown")).toBeNull();
  });

  it("识别 CJK 语言分组和对应文字", () => {
    expect(is_cjk_language_code("ja")).toBe(true);
    expect(is_cjk_language_code("EN")).toBe(false);
    expect(has_language_character("かなカナ漢字", "JA")).toBe(true);
    expect(has_language_character("한국어", "KO")).toBe(true);
    expect(has_language_character("plain english line", "ZH")).toBe(false);
  });

  it("识别非 CJK 语言的特征字符", () => {
    expect(has_language_character("Привет", "RU")).toBe(true);
    expect(has_language_character("مرحبا", "AR")).toBe(true);
    expect(has_language_character("ภาษาไทย", "TH")).toBe(true);
    expect(has_language_character("français", "FR")).toBe(true);
    expect(has_language_character("plain english line", "VI")).toBe(true);
  });

  it("导出的假名和谚文判断复用统一例外口径", () => {
    expect(is_kana_character("か")).toBe(true);
    expect(is_kana_character("カ")).toBe(true);
    expect(is_kana_character("ー")).toBe(false);
    expect(is_kana_character("・")).toBe(false);
    expect(is_hangul_character("한")).toBe(true);
    expect(is_hangul_character("A")).toBe(false);
  });

  it("正则字符源与项目假名例外口径一致", () => {
    const pattern = new RegExp(`[${CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE}]`, "u");
    expect(pattern.test("漢")).toBe(true);
    expect(pattern.test("か")).toBe(true);
    expect(pattern.test("カ")).toBe(true);
    expect(pattern.test("한")).toBe(true);
    expect(pattern.test("ー")).toBe(false);
    expect(pattern.test("・")).toBe(false);
    expect(pattern.test("･")).toBe(false);
  });

  it("按语言字符规则判断任意、全部和首尾剥离", () => {
    expect(has_language_character("a你", "ZH")).toBe(true);
    expect(has_language_character("abc", "ZH")).toBe(false);
    expect(has_language_character("", "ZH")).toBe(false);

    expect(all_language_characters("你好", "ZH")).toBe(true);
    expect(all_language_characters("你A", "ZH")).toBe(false);
    expect(all_language_characters("", "ZH")).toBe(true);

    expect(strip_non_language_characters("!!你A好??", "ZH")).toBe("你A好");
    expect(strip_non_language_characters("  !!!???  ", "ZH")).toBe("");
    expect(strip_non_language_characters("  \t\n  ", "ZH")).toBe("");
  });

  it.each([
    ["ZH", "你", true],
    ["ZH", "。", false],
    ["ZH", "A", false],
    ["EN", "A", true],
    ["EN", "é", true],
    ["EN", "！", false],
  ] as const)("按历史 TextBase 口径判断 %s 字符 %s", (language_code, char, expected) => {
    expect(is_language_character(char, language_code)).toBe(expected);
  });

  it("日文判断支持汉字、平假名和片假名", () => {
    expect(is_language_character("你", "JA")).toBe(true);
    expect(is_language_character("あ", "JA")).toBe(true);
    expect(is_language_character("カ", "JA")).toBe(true);
  });

  it("平假名判断只命中平假名文本", () => {
    expect(is_hiragana_character("あ")).toBe(true);
    expect(has_any_hiragana_character("abcあ")).toBe(true);
    expect(has_any_hiragana_character("ABC")).toBe(false);
    expect(has_only_hiragana_characters("あい")).toBe(true);
    expect(has_only_hiragana_characters("あA")).toBe(false);
  });

  it("片假名判断排除长音符", () => {
    expect(is_katakana_character("カ")).toBe(true);
    expect(is_katakana_character("ー")).toBe(false);
    expect(has_any_katakana_character("abcカ")).toBe(true);
    expect(has_any_katakana_character("abc")).toBe(false);
    expect(has_only_katakana_characters("カタ")).toBe(true);
    expect(has_only_katakana_characters("カあ")).toBe(false);
  });

  it("韩文判断支持汉字和谚文", () => {
    expect(is_language_character("你", "KO")).toBe(true);
    expect(is_language_character("한", "KO")).toBe(true);
    expect(is_language_character("A", "KO")).toBe(false);
  });

  it("谚文判断只命中谚文文本", () => {
    expect(has_any_hangul_character("A한")).toBe(true);
    expect(has_any_hangul_character("ABC")).toBe(false);
    expect(has_only_hangul_characters("한국")).toBe(true);
    expect(has_only_hangul_characters("한A")).toBe(false);
  });

  it.each([
    ["RU", "Ж"],
    ["AR", "ع"],
    ["DE", "ß"],
    ["FR", "œ"],
    ["PL", "Ł"],
    ["ES", "ñ"],
    ["IT", "è"],
    ["PT", "ã"],
    ["HU", "ő"],
    ["TR", "İ"],
    ["TH", "ก"],
    ["ID", "A"],
    ["VI", "ạ"],
  ] as const)("识别 %s 的代表字符 %s", (language_code, sample_char) => {
    expect(is_language_character(sample_char, language_code)).toBe(true);
  });
});
