import { describe, expect, it } from "vitest";

import {
  ALL_LANGUAGE_CODE,
  LANGUAGE_DEFINITIONS,
  SOURCE_TARGET_LANGUAGE_CODES,
  has_language_character,
  is_cjk_language_code,
  normalize_language_code,
} from "./languages";

describe("languages", () => {
  it("以语言定义表作为前端语言代码清单事实源", () => {
    expect(Object.keys(LANGUAGE_DEFINITIONS).sort()).toEqual(
      [ALL_LANGUAGE_CODE, ...SOURCE_TARGET_LANGUAGE_CODES].sort(),
    );
  });

  it("按 Python BaseLanguage 口径归一化语言代码", () => {
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
});
