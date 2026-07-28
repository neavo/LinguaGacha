import { describe, expect, it } from "vitest";

import { InvalidTargetLanguageError, UnsupportedAllTargetLanguageError } from "../shared/error";
import {
  ALL_LANGUAGE_CODE,
  SOURCE_LANGUAGE_CODES,
  TARGET_LANGUAGE_CODES,
  get_prompt_source_language_name,
  get_prompt_target_language_name,
  has_cjk_language_character,
  has_language_character,
  is_cjk_language_code,
  is_hangul_character,
  is_kana_character,
  is_non_standalone_language_character,
  normalize_language_code,
} from "./language";

describe("语言规则", () => {
  it("源语言排除繁中，目标语言将繁中与中文相邻排列", () => {
    expect(SOURCE_LANGUAGE_CODES).not.toContain("ZH-HANT");
    expect(TARGET_LANGUAGE_CODES.slice(0, 3)).toEqual(["ZH", "ZH-HANT", "EN"]);
  });

  it("提示词泛化未限定的源语言并拒绝无效目标语言", () => {
    expect(get_prompt_source_language_name(ALL_LANGUAGE_CODE, "zh")).toBe("原文");
    expect(get_prompt_source_language_name(null, "en")).toBe("Source");
    expect(get_prompt_target_language_name("ZH-HANT", "de")).toBe("Chinesisch (traditionell)");
    expect(() => get_prompt_target_language_name(ALL_LANGUAGE_CODE, "zh")).toThrowError(
      UnsupportedAllTargetLanguageError,
    );
    expect(() => get_prompt_target_language_name(null, "zh")).toThrowError(
      InvalidTargetLanguageError,
    );
  });

  it("归一化合法语言代码并拒绝未知格式", () => {
    expect(normalize_language_code("fr")).toBe("FR");
    expect(normalize_language_code(" zh-hant ")).toBe("ZH-HANT");
    expect(normalize_language_code("ZH_HANT")).toBeNull();
    expect(normalize_language_code("unknown")).toBeNull();
  });

  it("归一化后识别 CJK 语言分组", () => {
    expect(is_cjk_language_code("ja")).toBe(true);
    expect(is_cjk_language_code("zh-hant")).toBe(true);
    expect(is_cjk_language_code("EN")).toBe(false);
    expect(is_cjk_language_code("unknown")).toBe(false);
  });

  it.each([
    ["ZH", "你"],
    ["ZH-HANT", "繁"],
    ["EN", "A"],
    ["JA", "あ"],
    ["KO", "한"],
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
  ] as const)("%s 识别代表正文 %s", (language_code, sample_text) => {
    expect(has_language_character(sample_text, language_code)).toBe(true);
  });

  it.each([
    ["ZH", ["𰀀", "﨎"], []],
    ["RU", ["Ёжик"], ["Ⰰ"]],
    ["AR", ["ࡰ"], ["\u064e", "٣"]],
    ["TH", ["ภาษาไทย"], ["\u0e48", "๕"]],
    ["FR", ["e\u0301"], ["\u0301", "×÷"]],
    ["JA", ["カーテン"], ["ーーー"]],
  ] as const)(
    "%s 按 Unicode Script 区分正文与附着标记或符号",
    (language_code, accepted, rejected) => {
      for (const text of accepted) {
        expect(has_language_character(text, language_code)).toBe(true);
      }
      for (const text of rejected) {
        expect(has_language_character(text, language_code)).toBe(false);
      }
    },
  );

  it("语言预过滤按任意正文字符命中，ALL 则关闭过滤", () => {
    expect(has_language_character("a你", "ZH")).toBe(true);
    expect(has_language_character("abc", "ZH")).toBe(false);
    expect(has_language_character("", "ZH")).toBe(false);
    expect(has_language_character("", ALL_LANGUAGE_CODE)).toBe(true);
  });

  it("fixer 共用的假名和谚文判断排除非正文标记", () => {
    for (const char of ["か", "カ", "ｶ"]) {
      expect(is_kana_character(char)).toBe(true);
    }
    for (const char of ["ー", "・", "･", "゙", "゚", "ﾞ", "ﾟ"]) {
      expect(is_kana_character(char)).toBe(false);
    }
    expect(is_hangul_character("한")).toBe(true);
    expect(is_hangul_character("A")).toBe(false);
  });

  it("规则预过滤将附着标记视为非独立语言字符", () => {
    for (const char of ["ー", "゙", "\u064e", "\u0e48"]) {
      expect(is_non_standalone_language_character(char)).toBe(true);
    }
    expect(is_non_standalone_language_character("カ")).toBe(false);
  });

  it("文本保护只在占位符包含 CJK 正文时命中", () => {
    expect(has_cjk_language_character("{名前}")).toBe(true);
    expect(has_cjk_language_character("{player_name}")).toBe(false);
  });
});
