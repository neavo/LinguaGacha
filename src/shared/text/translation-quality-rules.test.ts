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

  it("相似文本使用包含关系和字符集合 Jaccard 判断", () => {
    expect(is_translation_text_similar("alpha", "alpha!")).toBe(true);
    expect(is_translation_text_similar("abc", "xyz")).toBe(false);
    expect(is_translation_text_similar("", "alpha")).toBe(false);
  });

  it("日韩译中文时相似 issue 必须伴随对应残留", () => {
    expect(
      has_translation_similarity_issue({
        src: "東京",
        dst: "東京",
        sourceLanguage: "JA",
        targetLanguage: "ZH",
      }),
    ).toBe(false);
    expect(
      has_translation_similarity_issue({
        src: "東京",
        dst: "東京あ",
        sourceLanguage: "JA",
        targetLanguage: "ZH-HANT",
      }),
    ).toBe(true);
    expect(
      has_translation_similarity_issue({
        src: "韓國",
        dst: "韓國",
        sourceLanguage: "KO",
        targetLanguage: "ZH",
      }),
    ).toBe(false);
    expect(
      has_translation_similarity_issue({
        src: "韓國",
        dst: "韓國한",
        sourceLanguage: "KO",
        targetLanguage: "ZH",
      }),
    ).toBe(true);
  });

  it("非日韩译中文场景只要相似即可返回 issue", () => {
    expect(
      has_translation_similarity_issue({
        src: "same text",
        dst: "same text",
        sourceLanguage: "EN",
        targetLanguage: "ZH",
      }),
    ).toBe(true);
    expect(
      has_translation_similarity_issue({
        src: "東京",
        dst: "東京",
        sourceLanguage: "JA",
        targetLanguage: "EN",
      }),
    ).toBe(true);
  });
});
