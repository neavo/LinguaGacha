import { describe, expect, it } from "vitest";

import {
  collect_translation_residue_fragments,
  has_translation_retry_reached_review_threshold,
  has_translation_similarity_issue,
  is_translation_text_similar,
} from "./translation-quality-rules";

describe("translation-quality-rules", () => {
  it("按源语言收集假名和谚文残留片段", () => {
    expect(
      collect_translation_residue_fragments({
        text: "甲かな乙カナかな",
        sourceLanguage: "JA",
      }),
    ).toEqual({
      kana: ["かな", "カナかな"],
      hangeul: [],
    });

    expect(
      collect_translation_residue_fragments({
        text: "甲번역乙번역",
        sourceLanguage: "KO",
      }),
    ).toEqual({
      kana: [],
      hangeul: ["번역"],
    });

    expect(
      collect_translation_residue_fragments({
        text: "かな번역",
        sourceLanguage: "EN",
      }),
    ).toEqual({
      kana: [],
      hangeul: [],
    });
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
    ["日译中无假名残留时不报告", "東京", "東京", "JA", "ZH", false],
    ["日译中有假名残留时报告", "東京", "東京あ", "JA", "ZH-HANT", true],
    ["韩译中无谚文残留时不报告", "韓國", "韓國", "KO", "ZH", false],
    ["韩译中有谚文残留时报告", "韓國", "韓國한", "KO", "ZH", true],
    ["非日韩译中时相似即报告", "same text", "same text", "EN", "ZH", true],
    ["日韩译非中文时相似即报告", "東京", "東京", "JA", "EN", true],
  ] as const)("%s", (_name, src, dst, sourceLanguage, targetLanguage, expected) => {
    expect(has_translation_similarity_issue({ src, dst, sourceLanguage, targetLanguage })).toBe(
      expected,
    );
  });
});
