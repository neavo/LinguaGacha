import { describe, expect, it } from "vitest";

import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import {
  buildProofreadingEvaluationContext,
  evaluateProofreadingItem,
} from "./proofreading-evaluator";
import type { ItemNameField } from "../../domain/item";
import type { TextProcessingConfig } from "../text/text-types";

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
  processingConfig?: Partial<TextProcessingConfig>;
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
    quality_context: buildProofreadingEvaluationContext(quality),
    processingConfig: {
      source_language: args.sourceLanguage,
      target_language: args.targetLanguage ?? "ZH",
      clean_ruby: false,
      auto_process_prefix_suffix_preserved_text: true,
      ...args.processingConfig,
    },
    sample_rule_cache: new Map(),
  });
}

describe("proofreading-evaluator", () => {
  it("禁用规则也必须通过真实编译校验", () => {
    const quality = create_quality({
      pre_replacement: {
        enabled: false,
        mode: "off",
        revision: 1,
        entries: [{ src: "(", dst: "x", regex: true }],
      },
    });

    expect(() => buildProofreadingEvaluationContext(quality)).toThrow("质量规则正则不是合法正则");
  });

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
    expect(item?.glossary_applications).toMatchObject([
      {
        src: "HP",
        dst: "生命值",
        fields: [{ source_field: "src", target_field: "dst", applied: false }],
      },
    ]);
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
    expect(item?.glossary_applications).toMatchObject([
      {
        src: "Alice",
        dst: "艾丽丝",
        fields: [{ source_field: "name_src", target_field: "name_dst", applied: false }],
      },
    ]);
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
    expect(item?.glossary_applications).toMatchObject([
      {
        src: "Alice",
        dst: "艾丽丝",
        fields: [{ source_field: "name_src", target_field: "name_dst", applied: true }],
      },
    ]);
  });

  it("逐行正向应用译前替换，并且不逆向解释最终译文", () => {
    const pre_quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "off",
        revision: 1,
        entries: [{ src: '^"', dst: "<Q>", regex: true, case_sensitive: true }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "<Q>", info: "" }],
      },
    });
    expect(
      evaluate({
        src: '"one\n"two',
        dst: "<Q>一\n<Q>二",
        sourceLanguage: "EN",
        quality: pre_quality,
      })?.warnings,
    ).not.toContain("TEXT_PRESERVE");

    const post_quality = create_quality({
      post_replacement: {
        enabled: true,
        mode: "off",
        revision: 1,
        entries: [{ src: '^"', dst: "「", regex: true, case_sensitive: true }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: '\\^"', info: "" }],
      },
    });
    expect(
      evaluate({ src: '"source', dst: "「译文", sourceLanguage: "EN", quality: post_quality })
        ?.warnings,
    ).not.toContain("TEXT_PRESERVE");
  });

  it("文本保护按行精确比较原始片段", () => {
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "<[^>]+>" }, { src: "A\\nB" }],
      },
    });

    expect(
      evaluate({ src: "A\nB", dst: "A\nX", sourceLanguage: "EN", quality })?.warnings,
    ).not.toContain("TEXT_PRESERVE");
    const whitespace = evaluate({
      src: "source <A B>",
      dst: "译文 <AB>",
      sourceLanguage: "EN",
      quality,
    });
    expect(whitespace?.warnings).toContain("TEXT_PRESERVE");
    expect(whitespace?.warning_fragments_by_code.TEXT_PRESERVE).toEqual(["<A B>", "<AB>"]);

    expect(
      evaluate({ src: "<A>\ntext", dst: "text\n<A>", sourceLanguage: "EN", quality })?.warnings,
    ).toContain("TEXT_PRESERVE");
  });

  it("校对复用翻译的保护前缀优先顺序", () => {
    const quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "<A>", dst: "<X>", regex: false, case_sensitive: true }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "<[^>]+>" }],
      },
    });

    expect(
      evaluate({ src: "<A>hello", dst: "<A>你好", sourceLanguage: "EN", quality })?.warnings,
    ).not.toContain("TEXT_PRESERVE");
  });
});
