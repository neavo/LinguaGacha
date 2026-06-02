import { describe, expect, it } from "vitest";

import { buildQualityCompiledContext } from "../quality/compiled";
import type { QualitySnapshot } from "../quality/snapshot";
import { evaluateProofreadingItem } from "./proofreading-evaluator";
import type { ItemNameField } from "../../domain/item";

function create_quality(overrides: Partial<QualitySnapshot> = {}): QualitySnapshot {
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
  quality?: QualitySnapshot;
  name_src?: ItemNameField;
  name_dst?: ItemNameField;
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
      name_src: args.name_src ?? null,
      name_dst: args.name_dst ?? null,
      status: "PROCESSED",
      text_type: "NONE",
      retry_count: args.retry_count ?? 0,
    },
    quality,
    quality_context: buildQualityCompiledContext(quality),
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

  it("姓名字段中的术语缺失会触发术语警告", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "Alice", dst: "艾丽丝" }],
      },
    });

    const item = evaluate({
      src: "普通正文",
      dst: "",
      name_src: ["Alice", "隐藏姓名"],
      name_dst: ["旧译名", "隐藏译名"],
      sourceLanguage: "JA",
      quality,
    });

    expect(item?.warnings).toEqual(["GLOSSARY"]);
    expect(item?.failed_glossary_terms).toEqual([["Alice", "艾丽丝"]]);
  });

  it("姓名译文满足术语时不触发正文类警告", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "Alice", dst: "艾丽丝" }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "\\{[^}]+\\}" }],
      },
    });

    const item = evaluate({
      src: "正文 {PLAYER}",
      dst: "",
      name_src: "Alice",
      name_dst: "艾丽丝",
      sourceLanguage: "JA",
      quality,
    });

    expect(item?.warnings).toEqual([]);
    expect(item?.applied_glossary_terms).toEqual([["Alice", "艾丽丝"]]);
  });
});
