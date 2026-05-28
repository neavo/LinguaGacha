import { describe, expect, it } from "vitest";

import {
  buildProofreadingLookupQuery,
  getPromptSlice,
  getQualityRuleSlice,
  replacePromptSlice,
  replaceQualityRuleSlice,
} from "./quality-runtime";
import type {
  PromptRuntimeSlice,
  PromptsRuntimeState,
  QualityRuleRuntimeSlice,
  QualityRulesRuntimeState,
} from "./quality-runtime-state";

function create_quality_slice(
  overrides: Partial<QualityRuleRuntimeSlice> = {},
): QualityRuleRuntimeSlice {
  return {
    entries: [{ src: "魔法", dst: "Magic" }],
    enabled: true,
    mode: "custom",
    revision: 1,
    ...overrides,
  };
}

function create_quality_state(): QualityRulesRuntimeState {
  return {
    glossary: create_quality_slice(),
    pre_replacement: create_quality_slice({ entries: [{ src: "A", dst: "B" }] }),
    post_replacement: create_quality_slice({ entries: [{ src: "C", dst: "D" }] }),
    text_preserve: create_quality_slice({ mode: "smart", entries: [{ src: "\\d+" }] }),
  };
}

function create_prompt_slice(text: string): PromptRuntimeSlice {
  return {
    text,
    enabled: true,
    revision: 1,
  };
}

function create_prompt_state(): PromptsRuntimeState {
  return {
    translation: create_prompt_slice("翻译提示词"),
    analysis: create_prompt_slice("分析提示词"),
  };
}

describe("quality-runtime", () => {
  it("读取质量规则切片时返回克隆对象", () => {
    const quality = create_quality_state();

    const slice = getQualityRuleSlice(quality, "glossary");
    slice.entries[0] = { src: "改写" };

    expect(quality.glossary.entries).toEqual([{ src: "魔法", dst: "Magic" }]);
  });

  it("替换单个质量规则切片时不复用输入引用", () => {
    const quality = create_quality_state();
    const next_slice = create_quality_slice({ entries: [{ src: "勇者" }], revision: 2 });

    const next_quality = replaceQualityRuleSlice(quality, "text_preserve", next_slice);
    next_slice.entries[0] = { src: "污染" };

    expect(next_quality.text_preserve).toMatchObject({
      entries: [{ src: "勇者" }],
      revision: 2,
    });
    expect(next_quality.glossary).toEqual(quality.glossary);
  });

  it("读取和替换提示词切片时保持不可变语义", () => {
    const prompts = create_prompt_state();

    expect(getPromptSlice(prompts, "analysis")).toEqual({
      text: "分析提示词",
      enabled: true,
      revision: 1,
    });
    expect(replacePromptSlice(prompts, "translation", create_prompt_slice("新翻译"))).toEqual({
      translation: create_prompt_slice("新翻译"),
      analysis: create_prompt_slice("分析提示词"),
    });
  });

  it("构造校对查找 query 时让文本保护规则使用正则语义", () => {
    expect(
      buildProofreadingLookupQuery({
        rule_type: "text_preserve",
        entry: { src: "\\d+", regex: false },
      }),
    ).toEqual({ keyword: "\\d+", is_regex: true });
    expect(
      buildProofreadingLookupQuery({
        rule_type: "glossary",
        entry: { src: "魔法", regex: false },
      }),
    ).toEqual({ keyword: "魔法", is_regex: false });
  });
});
