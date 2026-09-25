import { describe, expect, it } from "vitest";

import type { QualitySnapshot } from "../quality/quality-rule-snapshot";
import {
  buildProofreadingEvaluationContext,
  evaluateProofreadingItem,
} from "./proofreading-evaluator";
import type { ItemNameField } from "../../domain/item";
import type { ConfiguredSourceLanguageCode, TargetLanguageCode } from "../../domain/language";
import type { TextProcessingConfig } from "../text/text-types";

/** 默认禁用可选规则，各用例只开启影响当前判断的质量配置。 */
function create_quality(overrides: Partial<QualitySnapshot> = {}): QualitySnapshot {
  return {
    glossary: { enabled: false, mode: "custom", revision: 0, entries: [] },
    pre_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
    post_replacement: { enabled: false, mode: "custom", revision: 0, entries: [] },
    text_preserve: { enabled: false, mode: "off", revision: 0, entries: [] },
    ...overrides,
  };
}

/** 使用真实规则编译和评估入口，默认提供已完成的正文条目。 */
function evaluate(args: {
  src: string;
  dst: string;
  sourceLanguage: ConfiguredSourceLanguageCode;
  targetLanguage?: TargetLanguageCode;
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
      internal_file_path: null,
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
      ...args.processingConfig,
    },
    sample_rule_cache: new Map(),
  });
}

describe("proofreading-evaluator", () => {
  it.each([
    ["token", "译文\n<A>", "原文\n<A>", ["LINE_COUNT_MISMATCH"]],
    ["token\n<A>", "译文\n<A>", "原文\r", []],
  ])("译前替换引入换行时按组合后的实际行比较保护段：%s", (src, dst, replacement, warnings) => {
    const quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [
          {
            entry_id: "replace-line",
            src: "token",
            dst: replacement,
            regex: false,
            case_sensitive: true,
          },
        ],
      },
    });
    const result = evaluate({ src, dst, sourceLanguage: "EN", quality });
    expect(result.warnings.map((warning) => warning.code)).toEqual(warnings);
  });

  it("跨行标点以整条正文比较", () => {
    expect(
      evaluate({
        src: "「こんにちは\n世界」",
        dst: "“你好世界”",
        sourceLanguage: "JA",
      }).warnings.map((warning) => warning.code),
    ).not.toContain("PUNCTUATION_MISMATCH");
  });

  it("标点检查排除保护段和资源引用，仍保留文本保护差异", () => {
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "tag", src: "<[^>]+>" }],
      },
    });
    const item = evaluate({
      src: '「こんにちは」<tag value="(x)"> https://example.com/a(1).png',
      dst: '“你好”<tag value="[]"> https://example.com/b(2)(3).png',
      sourceLanguage: "JA",
      quality,
    });
    expect(item.warnings.map((warning) => warning.code)).toContain("TEXT_PRESERVE");
    expect(item.warnings.map((warning) => warning.code)).not.toContain("PUNCTUATION_MISMATCH");
  });

  it("标点检查使用译前替换后的源文和最终译文", () => {
    const quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "opening", src: "「", dst: "", regex: false, case_sensitive: true }],
      },
    });
    expect(
      evaluate({ src: "「こんにちは", dst: "你好", sourceLanguage: "JA", quality }).warnings.map(
        (warning) => warning.code,
      ),
    ).not.toContain("PUNCTUATION_MISMATCH");
    expect(
      evaluate({ src: "「こんにちは", dst: "「你好", sourceLanguage: "JA", quality }).warnings.map(
        (warning) => warning.code,
      ),
    ).toContain("PUNCTUATION_MISMATCH");
  });

  it("派生 item 行数变化 warning，并在修正后消失", () => {
    expect(
      evaluate({ src: "a\nb", dst: "甲", sourceLanguage: "EN" }).warnings.map(
        (warning) => warning.code,
      ),
    ).toContain("LINE_COUNT_MISMATCH");
    expect(
      evaluate({ src: "a\nb", dst: "甲\n乙", sourceLanguage: "EN" }).warnings.map(
        (warning) => warning.code,
      ),
    ).not.toContain("LINE_COUNT_MISMATCH");
  });

  it("禁用规则也必须通过真实编译校验", () => {
    const quality = create_quality({
      pre_replacement: {
        enabled: false,
        mode: "off",
        revision: 1,
        entries: [{ entry_id: "invalid", src: "(", dst: "x", regex: true }],
      },
    });

    expect(() => buildProofreadingEvaluationContext(quality)).toThrow(
      "Quality rule regex is invalid.",
    );
  });

  it("只按目标语言识别外文残留并保留完整片段", () => {
    const item = evaluate({
      src: "source",
      dst: "中文か\u3099，OpenAI，текст",
      sourceLanguage: "EN",
      targetLanguage: "ZH",
    });
    expect(item.warnings.map((warning) => warning.code)).toContain("FOREIGN_CHAR_RESIDUE");
    expect(item.warnings.find((warning) => warning.code === "FOREIGN_CHAR_RESIDUE")).toEqual({
      code: "FOREIGN_CHAR_RESIDUE",
      target_field: "dst",
      fragments: ["か\u3099", "OpenAI", "текст"],
    });
    expect(
      evaluate({
        src: "source",
        dst: "かな",
        sourceLanguage: "EN",
        targetLanguage: "JA",
      }).warnings.map((warning) => warning.code),
    ).not.toContain("FOREIGN_CHAR_RESIDUE");
  });

  it("资源引用不参与外文残留检查", () => {
    expect(
      evaluate({
        src: "リンク https://example.com/image.png",
        dst: "链接 https://example.com/image.png",
        sourceLanguage: "JA",
        targetLanguage: "ZH",
      }).warnings.map((warning) => warning.code),
    ).not.toContain("FOREIGN_CHAR_RESIDUE");
  });

  it("已保护片段不参与外文残留检查", () => {
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "placeholder", src: "\\{[^}]+\\}" }],
      },
    });

    expect(
      evaluate({
        src: "{PLAYER}正文",
        dst: "{OpenAI}译文",
        sourceLanguage: "EN",
        targetLanguage: "ZH",
        quality,
      }).warnings.map((warning) => warning.code),
    ).not.toContain("FOREIGN_CHAR_RESIDUE");
  });

  it("识别文本保护、相似度、术语和重试阈值警告", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "player", src: "\\{[^}]+\\}" }],
      },
    });

    const item = evaluate({
      src: "HP {PLAYER} 東京",
      dst: "HP {PLAYER2} 東京あ",
      sourceLanguage: "JA",
      retry_count: 2,
      quality,
    });

    expect(item.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["TEXT_PRESERVE", "SIMILARITY", "GLOSSARY", "RETRY_THRESHOLD"]),
    );
    expect(item.glossary_applications).toMatchObject([
      {
        src: "HP",
        dst: "生命值",
        fields: [{ source_field: "src", target_field: "dst", applied: false }],
      },
    ]);
    expect(item.warnings.find((warning) => warning.code === "TEXT_PRESERVE")).toEqual({
      code: "TEXT_PRESERVE",
      target_field: "dst",
      source_fragments: ["{PLAYER}"],
      translation_fragments: ["{PLAYER2}"],
    });
  });

  it("姓名字段中的术语缺失会触发术语警告", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "alice", src: "Alice", dst: "艾丽丝" }],
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

    expect(item.warnings.map((warning) => warning.code)).toEqual(["GLOSSARY"]);
    expect(item.glossary_applications).toMatchObject([
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
        entries: [{ entry_id: "alice", src: "Alice", dst: "艾丽丝" }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "player", src: "\\{[^}]+\\}" }],
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

    expect(item.warnings.map((warning) => warning.code)).toEqual([]);
    expect(item.glossary_applications).toMatchObject([
      {
        src: "Alice",
        dst: "艾丽丝",
        fields: [{ source_field: "name_src", target_field: "name_dst", applied: true }],
      },
    ]);
  });

  it("正文与姓名分别保留残留和保护证据，姓名同时检查标点", () => {
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "player", src: "\\{[^}]+\\}" }],
      },
    });
    expect(
      evaluate({
        src: "正文 {PLAYER}",
        dst: "正文かな {BODY}",
        name_src: ["Alice（幼年）{PLAYER}", "忽略"],
        name_dst: ["かな {NAME}", "ignore"],
        sourceLanguage: "JA",
        quality,
      }).warnings,
    ).toEqual([
      { code: "FOREIGN_CHAR_RESIDUE", target_field: "dst", fragments: ["かな"] },
      { code: "FOREIGN_CHAR_RESIDUE", target_field: "name_dst", fragments: ["かな"] },
      { code: "SIMILARITY", target_field: "dst" },
      {
        code: "TEXT_PRESERVE",
        target_field: "dst",
        source_fragments: ["{PLAYER}"],
        translation_fragments: ["{BODY}"],
      },
      {
        code: "TEXT_PRESERVE",
        target_field: "name_dst",
        source_fragments: ["{PLAYER}"],
        translation_fragments: ["{NAME}"],
      },
      { code: "PUNCTUATION_MISMATCH", target_field: "name_dst" },
    ]);
  });

  it("姓名使用原始整段保护语义，正文使用译前替换后的保护语义", () => {
    const quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "replace", src: "<A>", dst: "<B>", regex: false }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "tag", src: "<[^>]+>" }],
      },
    });
    expect(
      evaluate({
        src: "hello <A>",
        dst: "你好 <B>",
        name_src: "Alice <A>",
        name_dst: "艾丽丝 <B>",
        sourceLanguage: "EN",
        quality,
      }).warnings,
    ).toEqual([
      {
        code: "TEXT_PRESERVE",
        target_field: "name_dst",
        source_fragments: ["<A>"],
        translation_fragments: ["<B>"],
      },
    ]);
    expect(
      evaluate({
        src: "",
        dst: "",
        name_src: "<A\nB>Alice",
        name_dst: "艾丽丝",
        sourceLanguage: "EN",
        quality,
      }).warnings,
    ).toEqual([
      {
        code: "TEXT_PRESERVE",
        target_field: "name_dst",
        source_fragments: ["<A\nB>"],
        translation_fragments: [],
      },
    ]);
  });

  it("姓名排除保护和资源引用，并允许原名相似及换行差异", () => {
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "name", src: "Alice" }],
      },
    });
    expect(
      evaluate({
        src: "",
        dst: "",
        name_src: ["Alice\nhttps://example.com/(a)", "かな"],
        name_dst: ["Alice https://example.com/(a)", "かな"],
        sourceLanguage: "EN",
        quality,
      }).warnings,
    ).toEqual([]);
    expect(
      evaluate({
        src: "",
        dst: "",
        name_src: "Alice\nSmith",
        name_dst: "Alice Smith",
        sourceLanguage: "EN",
        targetLanguage: "EN",
      }).warnings,
    ).toEqual([]);
  });

  it("空译名跳过新增比较，术语仍逐字段报告缺失", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "alice", src: "Alice", dst: "艾丽丝" }],
      },
    });
    expect(
      evaluate({
        src: "Alice",
        dst: "旧译名",
        name_src: "Alice（幼年）{PLAYER}",
        name_dst: "",
        sourceLanguage: "EN",
        quality,
      }).warnings,
    ).toEqual([
      { code: "GLOSSARY", target_field: "dst" },
      { code: "GLOSSARY", target_field: "name_dst" },
    ]);
  });

  it("满足姓名术语不会豁免外文残留，只有姓名译文也检查重试", () => {
    const quality = create_quality({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "alice", src: "Alice", dst: "Alice" }],
      },
    });
    expect(
      evaluate({
        src: "",
        dst: "",
        name_src: "Alice",
        name_dst: "Alice",
        sourceLanguage: "EN",
        quality,
        retry_count: 2,
      }).warnings,
    ).toEqual([
      { code: "FOREIGN_CHAR_RESIDUE", target_field: "name_dst", fragments: ["Alice"] },
      { code: "RETRY_THRESHOLD", target_field: null },
    ]);
  });

  it("注音清理和译前替换都沿用翻译的资源保护边界", () => {
    const text = "甘岸久弥[https://mypage.syosetu.com/1300935/]";
    expect(
      evaluate({
        src: text,
        dst: text,
        sourceLanguage: "JA",
        processingConfig: { clean_ruby: true },
      }).warnings,
    ).toEqual([]);
    const quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "colon", src: ":", dst: "：", regex: false }],
      },
    });
    expect(
      evaluate({
        src: "参照 https://example.com/(a)",
        dst: "参考 https://example.com/(a)",
        sourceLanguage: "JA",
        quality,
      }).warnings,
    ).toEqual([]);
  });

  it.each(["dst", "name_dst"] as const)("资源后的普通文字保留检查边界：%s", (field) => {
    const input = (src: string, dst: string) =>
      field === "dst" ? { src, dst } : { src: "原文", dst: "译文", name_src: src, name_dst: dst };
    expect(
      evaluate({
        ...input("参照 https://example.com/a (注記)", "参考 https://example.com/a （备注）"),
        sourceLanguage: "JA",
      }).warnings,
    ).toEqual([]);
    expect(
      evaluate({
        ...input("本文 https://example.com/a 原文", "译文 https://example.com/a カナ"),
        sourceLanguage: "JA",
      }).warnings,
    ).toEqual([{ code: "FOREIGN_CHAR_RESIDUE", target_field: field, fragments: ["カナ"] }]);
  });

  it.each([
    ["https://example.com/a.png", "", ["https://example.com/a.png"], []],
    [
      "https://example.com/a.png",
      "https://example.com/b.png",
      ["https://example.com/a.png"],
      ["https://example.com/b.png"],
    ],
    [
      "https://example.com/a.png https://example.com/a.png",
      "https://example.com/a.png",
      ["https://example.com/a.png"],
      [],
    ],
    [
      "https://example.com/a.png https://example.com/b.png",
      "https://example.com/b.png https://example.com/a.png",
      ["https://example.com/a.png", "https://example.com/b.png"],
      ["https://example.com/b.png", "https://example.com/a.png"],
    ],
    ["", "https://example.com/a.png", [], ["https://example.com/a.png"]],
  ])(
    "按真实引用值、数量和顺序检查正文与姓名：%s → %s",
    (src, dst, source_fragments, translation_fragments) => {
      for (const field of ["dst", "name_dst"] as const) {
        const input =
          field === "dst"
            ? { src: `原文 ${src}`, dst: `译文 ${dst}` }
            : { src: "原文", dst: "译文", name_src: `原名 ${src}`, name_dst: `译名 ${dst}` };
        expect(evaluate({ ...input, sourceLanguage: "JA" }).warnings).toEqual([
          { code: "TEXT_PRESERVE", target_field: field, source_fragments, translation_fragments },
        ]);
      }
    },
  );

  it("跨行移动资源会报告保护差异，包住资源的保护段只比较一次", () => {
    const url = "https://example.com/a.png";
    expect(
      evaluate({ src: `原文 ${url}\n正文`, dst: `译文\n正文 ${url}`, sourceLanguage: "JA" })
        .warnings,
    ).toEqual([
      {
        code: "TEXT_PRESERVE",
        target_field: "dst",
        source_fragments: [url],
        translation_fragments: [url],
      },
    ]);
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "brackets", src: "\\[[^\\]]+\\]" }],
      },
    });
    expect(
      evaluate({
        src: `原文 [${url}]`,
        dst: "译文 [https://example.com/b.png]",
        sourceLanguage: "JA",
        quality,
      }).warnings,
    ).toEqual([
      {
        code: "TEXT_PRESERVE",
        target_field: "dst",
        source_fragments: [`[${url}]`],
        translation_fragments: ["[https://example.com/b.png]"],
      },
    ]);
  });

  it("逐行正向应用译前替换，并且不逆向解释最终译文", () => {
    const pre_quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "off",
        revision: 1,
        entries: [{ entry_id: "quote", src: '^"', dst: "<Q>", regex: true, case_sensitive: true }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "quote", src: "<Q>", info: "" }],
      },
    });
    expect(
      evaluate({
        src: '"one\n"two',
        dst: "<Q>一\n<Q>二",
        sourceLanguage: "EN",
        quality: pre_quality,
      }).warnings.map((warning) => warning.code),
    ).not.toContain("TEXT_PRESERVE");

    const post_quality = create_quality({
      post_replacement: {
        enabled: true,
        mode: "off",
        revision: 1,
        entries: [{ entry_id: "quote", src: '^"', dst: "「", regex: true, case_sensitive: true }],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "quote", src: '\\^"', info: "" }],
      },
    });
    expect(
      evaluate({
        src: '"source',
        dst: "「译文",
        sourceLanguage: "EN",
        quality: post_quality,
      }).warnings.map((warning) => warning.code),
    ).not.toContain("TEXT_PRESERVE");
  });

  it("文本保护按行精确比较原始片段", () => {
    const quality = create_quality({
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [
          { entry_id: "tag", src: "<[^>]+>" },
          { entry_id: "line", src: "A\\nB" },
        ],
      },
    });

    expect(
      evaluate({ src: "A\nB", dst: "A\nX", sourceLanguage: "EN", quality }).warnings.map(
        (warning) => warning.code,
      ),
    ).not.toContain("TEXT_PRESERVE");
    const whitespace = evaluate({
      src: "source <A B>",
      dst: "译文 <AB>",
      sourceLanguage: "EN",
      quality,
    });
    expect(whitespace.warnings.map((warning) => warning.code)).toContain("TEXT_PRESERVE");
    expect(whitespace.warnings.find((warning) => warning.code === "TEXT_PRESERVE")).toEqual({
      code: "TEXT_PRESERVE",
      target_field: "dst",
      source_fragments: ["<A B>"],
      translation_fragments: ["<AB>"],
    });

    expect(
      evaluate({ src: "<A>\ntext", dst: "text\n<A>", sourceLanguage: "EN", quality }).warnings.map(
        (warning) => warning.code,
      ),
    ).toContain("TEXT_PRESERVE");
  });

  it("校对按译前替换后的首尾保护段报告差异", () => {
    const quality = create_quality({
      pre_replacement: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [
          { entry_id: "replace-a", src: "A", dst: "X", regex: false, case_sensitive: true },
        ],
      },
      text_preserve: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ entry_id: "tag", src: "<[^>]+>" }],
      },
    });

    expect(
      evaluate({
        src: "<A>hello</A>",
        dst: "<X>你好</X>",
        sourceLanguage: "EN",
        quality,
      }).warnings.map((warning) => warning.code),
    ).not.toContain("TEXT_PRESERVE");
    for (const dst of ["<A>你好</A>", "你好"]) {
      expect(
        evaluate({ src: "<A>hello</A>", dst, sourceLanguage: "EN", quality }).warnings.map(
          (warning) => warning.code,
        ),
      ).toContain("TEXT_PRESERVE");
    }
  });
});
