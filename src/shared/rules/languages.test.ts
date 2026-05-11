import { describe, expect, it } from "vitest";

import {
  ALL_LANGUAGE_CODE,
  CJK_LANGUAGE_CHARACTER_PATTERN_SOURCE,
  LANGUAGE_DEFINITIONS,
  SOURCE_TARGET_LANGUAGE_CODES,
  has_language_character,
  is_cjk_language_code,
  is_hangul_character,
  is_kana_character,
  normalize_language_code,
} from "./languages";

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
});
