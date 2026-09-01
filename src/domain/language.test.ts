import { describe, expect, it } from "vitest";
import {
  ALL_LANGUAGE_CODE,
  classify_language_grapheme,
  get_prompt_source_language_name,
  get_prompt_target_language_name,
  has_cjk_language_character,
  has_language_body_character,
  has_language_character,
  is_cjk_language_code,
  normalize_language_code,
  normalize_source_language_code,
  normalize_target_language_code,
} from "./language";

describe("语言规则", () => {
  it("提示词泛化未限定的源语言并拒绝无效目标语言", () => {
    expect(get_prompt_source_language_name(ALL_LANGUAGE_CODE, "zh")).toBe("原文");
    expect(get_prompt_source_language_name(null, "en")).toBe("Source");
    expect(get_prompt_target_language_name("ZH-HANT", "de")).toBe("Chinesisch (traditionell)");
    expect(() => get_prompt_target_language_name(ALL_LANGUAGE_CODE, "zh")).toThrowError(
      expect.objectContaining({ code: "language.unsupported_all_target_language" }),
    );
    expect(() => get_prompt_target_language_name(null, "zh")).toThrowError(
      expect.objectContaining({ code: "language.invalid_target_language" }),
    );
  });

  it("归一化合法语言代码并拒绝未知格式", () => {
    expect(normalize_language_code("fr")).toBe("FR");
    expect(normalize_language_code(" zh-hant ")).toBe("ZH-HANT");
    expect(normalize_language_code("ZH_HANT")).toBeNull();
    expect(normalize_language_code("unknown")).toBeNull();
    expect(normalize_source_language_code("ZH-HANT")).toBeNull();
    expect(normalize_target_language_code("ALL")).toBeNull();
  });

  it("归一化后识别 CJK 语言分组", () => {
    expect(is_cjk_language_code("ja")).toBe(true);
    expect(is_cjk_language_code("zh-hant")).toBe(true);
    expect(is_cjk_language_code("EN")).toBe(false);
    expect(is_cjk_language_code("unknown")).toBe(false);
  });

  it.each([
    ["ZH", "你"],
    ["EN", "A"],
    ["JA", "あ"],
    ["KO", "한"],
    ["RU", "Ж"],
    ["AR", "ع"],
    ["TH", "ก"],
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

  it("通用正文判断排除书写附属字符并接受未登记文字", () => {
    expect(has_language_body_character("・･ー")).toBe(false);
    expect(has_language_body_character("β")).toBe(true);
  });

  it("按完整字素簇区分目标文字、残留和中性内容", () => {
    expect(classify_language_grapheme("か\u3099", "JA")).toBe("allowed");
    expect(classify_language_grapheme("か\u3099", "ZH")).toBe("residue");
    expect(classify_language_grapheme("َ", "AR")).toBe("allowed");
    expect(classify_language_grapheme("่", "ZH")).toBe("residue");
    expect(classify_language_grapheme("〮", "KO")).toBe("allowed");
    expect(classify_language_grapheme("〮", "EN")).toBe("residue");
    expect(classify_language_grapheme("́", "EN")).toBe("neutral");
    expect(classify_language_grapheme("👩‍💻", "ZH")).toBe("neutral");
  });

  it("将未登记的其它语言文字识别为残留", () => {
    expect(classify_language_grapheme("β", "ZH")).toBe("residue");
    expect(classify_language_grapheme("א", "EN")).toBe("residue");
  });

  it("文本保护只在占位符包含 CJK 正文时命中", () => {
    expect(has_cjk_language_character("{名前}")).toBe(true);
    expect(has_cjk_language_character("{player_name}")).toBe(false);
  });
});
