import { describe, expect, it } from "vitest";

import {
  collect_foreign_char_residue_fragments,
  has_translation_retry_reached_review_threshold,
  has_translation_similarity_issue,
  is_translation_text_similar,
} from "./translation-quality-rules";

describe("translation-quality-rules", () => {
  it("按目标语言收集连续外文残留片段并稳定去重", () => {
    expect(
      collect_foreign_char_residue_fragments({
        text: "甲かな乙カナかな，OpenAI，текст，한글，かな",
        targetLanguage: "ZH",
      }),
    ).toEqual(["かな", "カナかな", "OpenAI", "текст", "한글"]);
  });

  it("保留残留字素簇中的附标并忽略通用中性内容", () => {
    expect(
      collect_foreign_char_residue_fragments({
        text: "か\u3099 ｶﾞ ゛ 123 👩‍💻",
        targetLanguage: "ZH",
      }),
    ).toEqual(["か\u3099", "ｶﾞ", "゛"]);
  });

  it.each([
    ["ZH", "中文"],
    ["ZH-HANT", "繁體中文"],
    ["JA", "東京へ行く"],
    ["KO", "東京에 간다"],
    ["EN", "cafe\u0301"],
    ["RU", "Русский"],
    ["AR", "الْعَرَبِيَّةُـ"],
    ["TH", "ภาษาไทย่"],
  ] as const)("%s 允许自身书写系统：%s", (targetLanguage, text) => {
    expect(collect_foreign_char_residue_fragments({ text, targetLanguage })).toEqual([]);
  });

  it.each([
    ["ZH", "Latin"],
    ["JA", "한글"],
    ["KO", "かな"],
    ["EN", "Кириллица"],
    ["RU", "Latin"],
    ["AR", "Latin"],
    ["TH", "Latin"],
  ] as const)("%s 报告其它书写系统：%s", (targetLanguage, text) => {
    expect(collect_foreign_char_residue_fragments({ text, targetLanguage })).toEqual([text]);
  });

  it("重试次数达到人工校对阈值后返回 true", () => {
    expect(has_translation_retry_reached_review_threshold(1)).toBe(false);
    expect(has_translation_retry_reached_review_threshold(2)).toBe(true);
  });

  it("非空文本包含或高度重叠时判为相似，空文本或低重叠文本不相似", () => {
    expect(is_translation_text_similar("alpha", "alpha!")).toBe(true);
    expect(is_translation_text_similar("abcdefghij", "abcdefghik")).toBe(true);
    expect(is_translation_text_similar("abc", "abd")).toBe(false);
    expect(is_translation_text_similar("", "alpha")).toBe(false);
  });

  it.each([
    ["日译中无非中文文字时不报告", "東京", "東京", "JA", "ZH", false],
    ["日译中有非中文文字时报告", "東京", "東京あ", "JA", "ZH-HANT", true],
    ["韩译中无非中文文字时不报告", "韓國", "韓國", "KO", "ZH", false],
    ["韩译中有非中文文字时报告", "韓國", "韓國한", "KO", "ZH", true],
    ["非日韩译中时相似即报告", "same text", "same text", "EN", "ZH", true],
    ["日韩译非中文时相似即报告", "東京", "東京", "JA", "EN", true],
  ] as const)("%s", (_name, src, dst, sourceLanguage, targetLanguage, expected) => {
    expect(has_translation_similarity_issue({ src, dst, sourceLanguage, targetLanguage })).toBe(
      expected,
    );
  });
});
