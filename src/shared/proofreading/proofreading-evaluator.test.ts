import { describe, expect, it } from "vitest";

import { buildQualityRuntimeContext } from "../quality/quality-runtime-context";
import type { QualityRulesRuntimeState } from "../quality/quality-runtime-state";
import { evaluateProofreadingItem } from "./proofreading-evaluator";

function create_quality(
  overrides: Partial<QualityRulesRuntimeState> = {},
): QualityRulesRuntimeState {
  return {
    glossary: { enabled: false, mode: "custom", revision: 0, entries: [] },
    pre_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
    post_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
    text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
    ...overrides,
  };
}

function evaluate(args: {
  src: string;
  dst: string;
  sourceLanguage: string;
  targetLanguage?: string;
  retry_count?: number;
  quality?: QualityRulesRuntimeState;
}) {
  const quality = args.quality ?? create_quality();
  return evaluateProofreadingItem({
    item: {
      item_id: 1,
      file_path: "chapter.txt",
      file_order: 0,
      row_number: 1,
      src: args.src,
      dst: args.dst,
      status: "PROCESSED",
      text_type: "NONE",
      retry_count: args.retry_count ?? 0,
    },
    quality,
    quality_context: buildQualityRuntimeContext(quality),
    sourceLanguage: args.sourceLanguage,
    targetLanguage: args.targetLanguage ?? "ZH",
    sample_rule_cache: new Map(),
  });
}

describe("proofreading-evaluator", () => {
  it("按源语言识别假名和谚文残留", () => {
    expect(evaluate({ src: "東京", dst: "東京あ", sourceLanguage: "JA" })?.warnings).toContain(
      "KANA",
    );
    expect(evaluate({ src: "한국", dst: "한국한", sourceLanguage: "KO" })?.warnings).toContain(
      "HANGEUL",
    );
  });

  it("识别文本保护、相似度、术语和重试阈值警告", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "HP", dst: "生命值" }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "\\{[^}]+\\}" }],
      },
    });

    const item = evaluate({
      src: "HP {PLAYER} 東京",
      dst: "HP {PLAYER2} 東京あ",
      sourceLanguage: "JA",
      retry_count: 2,
      quality,
    });

    expect(item?.warnings).toEqual(
      expect.arrayContaining(["TEXT_PRESERVE", "SIMILARITY", "GLOSSARY", "RETRY_THRESHOLD"]),
    );
    expect(item?.failed_glossary_terms).toEqual([["HP", "生命值"]]);
    expect(item?.warning_fragments_by_code.TEXT_PRESERVE).toEqual(
      expect.arrayContaining(["{PLAYER}", "{PLAYER2}"]),
    );
  });
});
