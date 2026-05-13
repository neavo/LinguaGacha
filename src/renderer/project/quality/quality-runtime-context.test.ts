import { describe, expect, it } from "vitest";

import type { ProjectStoreQualityState } from "@/project/store/project-store";
import {
  applyQualityRuntimeReplacements,
  buildQualityRuleDependencyParts,
  buildQualityRuntimeContext,
  createQualityTextPreserveRegex,
  partitionQualityRuntimeGlossaryTerms,
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
    const text_preserve_regex = createQualityTextPreserveRegex({
      mode: "custom",
      text_type: "NONE",
      entries: [{ src: "\\d+" }],
    });

    expect(replaced).toEqual({ src_replaced: "A魔法", dst_replaced: "Magic" });
    expect(glossary_result.applied_terms).toEqual([["魔法", "Magic"]]);
    expect(text_preserve_regex?.test("编号 123")).toBe(true);
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
});
