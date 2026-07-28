import { describe, expect, it } from "vitest";

import {
  applyQualityCompiledReplacements,
  buildQualityCompiledContext,
  partitionQualityCompiledGlossaryTerms,
} from "./quality-rule-compiled-context";
import type { QualitySnapshot } from "./quality-rule-snapshot";

function create_quality_state(overrides: Partial<QualitySnapshot> = {}): QualitySnapshot {
  return {
    glossary: {
      enabled: true,
      mode: "custom",
      revision: 1,
      entries: [{ src: "HP", dst: "生命值" }],
    },
    pre_replacement: {
      enabled: true,
      mode: "custom",
      revision: 1,
      entries: [{ src: "Ａ", dst: "A", regex: false, case_sensitive: false }],
    },
    post_replacement: {
      enabled: true,
      mode: "custom",
      revision: 1,
      entries: [{ src: "法术\\1", dst: "Spell (\\d+)", regex: true, case_sensitive: false }],
    },
    text_preserve: {
      enabled: true,
      mode: "custom",
      revision: 1,
      entries: [],
    },
    ...overrides,
  };
}

describe("quality-compiled", () => {
  it("按规则方向执行预替换和后替换", () => {
    const context = buildQualityCompiledContext(create_quality_state());

    expect(applyQualityCompiledReplacements({ src: "ＡHP", dst: "Spell 12" }, context)).toEqual({
      src_replaced: "AHP",
      dst_replaced: "法术12",
    });
  });

  it("非法替换正则不改变原文和译文", () => {
    const context = buildQualityCompiledContext(
      create_quality_state({
        post_replacement: {
          enabled: true,
          mode: "custom",
          revision: 1,
          entries: [{ src: "(", dst: "坏规则", regex: true, case_sensitive: false }],
        },
      }),
    );

    expect(applyQualityCompiledReplacements({ src: "HP", dst: "Spell" }, context)).toEqual({
      src_replaced: "HP",
      dst_replaced: "Spell",
    });
  });

  it("同一术语在源文重复出现时只返回一次已应用术语", () => {
    const context = buildQualityCompiledContext(create_quality_state());

    expect(
      partitionQualityCompiledGlossaryTerms({
        glossary: context.glossary,
        source_replaced_parts: [{ field: "src", text: "HP + HP" }],
        translation_replaced_parts: [{ field: "dst", text: "生命值不足" }],
      }),
    ).toEqual({
      applied_terms: [["HP", "生命值"]],
      failed_terms: [],
    });
  });
});
