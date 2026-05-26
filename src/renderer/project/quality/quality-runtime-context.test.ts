import { describe, expect, it } from "vitest";

import type { ProjectStoreQualityState } from "@/project/store/project-store";
import {
  applyQualityRuntimeReplacements,
  buildQualityRuleDependencyParts,
  buildQualityRuntimeContext,
  collectNonBlankQualityPreservedSegments,
  createQualityTextPreserveRule,
  partitionQualityRuntimeGlossaryTerms,
  stripQualityPreservedSegments,
} from "@/project/quality/quality-runtime-context";

function create_quality_state(): ProjectStoreQualityState {
  return {
    glossary: {
      enabled: true,
      mode: "off",
      revision: 1,
      entries: [{ src: "魔法", dst: "Magic" }],
    },
    pre_replacement: {
      enabled: true,
      mode: "off",
      revision: 1,
      entries: [{ src: "Ａ", dst: "A" }],
    },
    post_replacement: {
      enabled: true,
      mode: "off",
      revision: 1,
      entries: [{ src: "Magic", dst: "Spell" }],
    },
    text_preserve: {
      enabled: false,
      mode: "custom",
      revision: 1,
      entries: [{ src: "\\d+" }],
    },
  };
}

describe("quality-runtime-context", () => {
  it("会用同一套质量运行时上下文处理替换、术语和文本保护", () => {
    const context = buildQualityRuntimeContext(create_quality_state());
    const replaced = applyQualityRuntimeReplacements({ src: "Ａ魔法", dst: "Spell" }, context);
    const glossary_result = partitionQualityRuntimeGlossaryTerms({
      glossary: context.glossary,
      src_replaced: replaced.src_replaced,
      dst_replaced: replaced.dst_replaced,
    });
    const text_preserve_rule = createQualityTextPreserveRule({
      mode: "custom",
      text_type: "NONE",
      entries: [{ src: "\\d+" }],
    });

    expect(replaced).toEqual({ src_replaced: "A魔法", dst_replaced: "Magic" });
    expect(glossary_result.applied_terms).toEqual([["魔法", "Magic"]]);
    expect(text_preserve_rule?.test("编号 123")).toBe(true);
  });

  it("校对质量运行态按替换规则的正则和大小写语义处理文本", () => {
    const context = buildQualityRuntimeContext({
      ...create_quality_state(),
      pre_replacement: {
        enabled: true,
        mode: "off",
        revision: 2,
        entries: [{ src: "Name: (.+)", dst: "\\1", regex: true, case_sensitive: true }],
      },
      post_replacement: {
        enabled: true,
        mode: "off",
        revision: 2,
        entries: [{ src: "$1", dst: "HP", regex: false, case_sensitive: true }],
      },
    });

    expect(applyQualityRuntimeReplacements({ src: "Name: Alice", dst: "HP" }, context)).toEqual({
      src_replaced: "Alice",
      dst_replaced: "$1",
    });
  });

  it("校对页复用共享智能保护语义排除含中日韩正文的 RenPy 段", () => {
    const text_preserve_rule = createQualityTextPreserveRule({
      mode: "smart",
      text_type: "RENPY",
      entries: [],
    });

    expect(stripQualityPreservedSegments("{player_name}你好", text_preserve_rule)).toBe("你好");
    expect(stripQualityPreservedSegments("{名前}你好", text_preserve_rule)).toBe("{名前}你好");
    expect(
      collectNonBlankQualityPreservedSegments("{player_name}{名前}", text_preserve_rule),
    ).toEqual(["{player_name}"]);
  });

  it("自定义保护规则由共享规则统一处理 Python 大码位写法", () => {
    const text_preserve_rule = createQualityTextPreserveRule({
      mode: "custom",
      text_type: "NONE",
      entries: [{ src: "\\U0001F600" }],
    });

    expect(text_preserve_rule?.collect("😀 ok")).toEqual(["😀"]);
  });

  it("规则依赖 parts 只覆盖影响匹配结果的字段", () => {
    expect(
      buildQualityRuleDependencyParts({
        ruleType: "pre_replacement",
        entry: { src: "A", dst: "B", regex: true, case_sensitive: false, info: "注释" },
      }),
    ).toEqual(["pre_replacement", "A", true, false]);
    expect(
      buildQualityRuleDependencyParts({
        ruleType: "text_preserve",
        entry: { src: "\\d+", case_sensitive: true },
      }),
    ).toEqual(["text_preserve", "\\d+"]);
  });

  it("术语匹配单次扫描仍保持嵌套术语、重复项和启用状态语义", () => {
    const context = buildQualityRuntimeContext({
      ...create_quality_state(),
      glossary: {
        enabled: true,
        mode: "off",
        revision: 2,
        entries: [
          { src: "魔法", dst: "Magic" },
          { src: "魔法少女", dst: "Magical Girl" },
          { src: "少女", dst: "Girl" },
          { src: "魔法", dst: "Magic" },
          { src: "", dst: "Empty" },
        ],
      },
    });

    expect(
      partitionQualityRuntimeGlossaryTerms({
        glossary: context.glossary,
        src_replaced: "魔法少女登场",
        dst_replaced: "Magic Girl",
      }),
    ).toEqual({
      applied_terms: [
        ["魔法", "Magic"],
        ["少女", "Girl"],
      ],
      failed_terms: [["魔法少女", "Magical Girl"]],
    });

    const disabled_context = buildQualityRuntimeContext({
      ...create_quality_state(),
      glossary: {
        enabled: false,
        mode: "off",
        revision: 3,
        entries: [{ src: "魔法", dst: "Magic" }],
      },
    });
    expect(
      partitionQualityRuntimeGlossaryTerms({
        glossary: disabled_context.glossary,
        src_replaced: "魔法",
        dst_replaced: "",
      }),
    ).toEqual({
      applied_terms: [],
      failed_terms: [],
    });
  });
});
