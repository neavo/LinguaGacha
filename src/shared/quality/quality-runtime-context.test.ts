import { describe, expect, it } from "vitest";

import {
  applyQualityRuntimeReplacements,
  buildQualityRuntimeContext,
  partitionQualityRuntimeGlossaryTerms,
} from "./quality-runtime-context";
import type { QualityRulesRuntimeState } from "./quality-runtime-state";

function create_quality_state(
  overrides: Partial<QualityRulesRuntimeState> = {},
): QualityRulesRuntimeState {
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

describe("quality-runtime-context", () => {
  it("构建阶段预编译替换规则并复用同一运行时执行文本替换", () => {
    const context = buildQualityRuntimeContext(create_quality_state());

    expect(applyQualityRuntimeReplacements({ src: "ＡHP", dst: "Spell 12" }, context)).toEqual({
      src_replaced: "AHP",
      dst_replaced: "法术12",
    });
  });

  it("非法正则在构建阶段跳过，后续 item 替换保持原文", () => {
    const context = buildQualityRuntimeContext(
      create_quality_state({
        post_replacement: {
          enabled: true,
          mode: "custom",
          revision: 1,
          entries: [{ src: "(", dst: "坏规则", regex: true, case_sensitive: false }],
        },
      }),
    );

    expect(applyQualityRuntimeReplacements({ src: "HP", dst: "Spell" }, context)).toEqual({
      src_replaced: "HP",
      dst_replaced: "Spell",
    });
  });

  it("术语运行时用 Aho 索引分出已应用与缺失术语", () => {
    const context = buildQualityRuntimeContext(create_quality_state());

    expect(
      partitionQualityRuntimeGlossaryTerms({
        glossary: context.glossary,
        src_replaced: "HP + HP",
        dst_replaced: "生命值不足",
      }),
    ).toEqual({
      applied_terms: [["HP", "生命值"]],
      failed_terms: [],
    });
  });
});
