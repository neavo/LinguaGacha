import { describe, expect, it } from "vitest";

import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import { TranslationPrePipeline } from "./translation-pre-pipeline";

describe("TranslationPrePipeline", () => {
  it("混合保护行和可翻译行时产出完整 item 文本", () => {
    const context = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot(),
    ).process_item(
      {
        src: "<skip>\nhello\n\nworld",
        text_type: "TXT",
      },
      4,
      9,
    );
    expect(context.request_item).toMatchObject({
      request_index: 9,
      item_index: 4,
      text_src: "<skip>\nhello\n\nworld",
    });
    expect(context.prepared_lines).toHaveLength(4);
  });

  it("保持源正文的 Unicode 形态进入模型行", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());
    const source_text = "ＡＢＣ１２３ ｶﾞ Cafe\u0301";

    const context = pipeline.process_item({
      src: source_text,
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual([source_text]);
  });

  it("记录并剥离每行头尾空白", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item({
      src: "  hello\t ",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["hello"]);
    expect(context.prepared_lines[0]).toMatchObject({
      leading_whitespace: "  ",
      trailing_whitespace: "\t ",
    });
  });

  it("抽取保护前后缀并记录恢复所需的位置", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]", info: "" }],
      }),
    );

    const context = pipeline.process_item({
      src: "  \\n[1]こんにちは\\n[2]  ",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["こんにちは"]);
    expect(context.prepared_lines[0]).toMatchObject({
      prefix_segments: ["\\n[1]"],
      suffix_segments: ["\\n[2]"],
    });
  });

  it("启用译前替换时把规则结果送入模型", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        pre_replacement_enable: true,
        pre_replacement_entries: [
          { src: "hello", dst: "你好", regex: false, case_sensitive: true },
        ],
      }),
    );

    expect(line_texts(pipeline.process_item({ src: "hello", text_type: "TXT" }))).toEqual(["你好"]);
  });

  it("带姓名的 item 不向模型输入注入姓名前缀", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item({
      src: "こんにちは",
      name_src: ["Alice"],
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["こんにちは"]);
    expect(context.request_item?.actor_src).toBe("Alice");
  });

  it("空 item 会返回同一形状的空上下文", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item(null);

    expect(line_texts(context)).toEqual([]);
    expect(context.samples).toEqual([]);
    expect(context.prepared_lines).toEqual([]);
  });

  it("跳过空白行并为 Markdown 追加固定控制字符示例", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
      }),
    );

    const context = pipeline.process_item({
      src: "   \nhello",
      text_type: "MD",
    });

    expect(line_texts(context)).toEqual(["hello"]);
    expect(context.prepared_lines.map((line) => line.state)).toEqual(["preserved", "translatable"]);
    expect(context.samples).toEqual(["Markdown Code"]);
  });

  it("只读取 item.src，不消费 EPUB 私有候选字段", () => {
    const pipeline = new TranslationPrePipeline(
      create_config({ clean_ruby: true }),
      create_quality_snapshot({ text_preserve_mode: "OFF" }),
    );

    const context = pipeline.process_item({
      src: "宝條直希",
      text_type: "TXT",
      extra_field: {
        epub: {
          mode: "block_text",
          cleaned_src: "错误候选",
        },
      },
    });

    expect(line_texts(context)).toEqual(["宝條直希"]);
    expect(context.prepared_lines[0]?.state).toBe("translatable");
  });

  it("关闭自动前后缀保护时保留原文并跳过完全保护行", () => {
    const pipeline = new TranslationPrePipeline(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );

    const fully_preserved = pipeline.process_item({
      src: "<b></b>",
      text_type: "TXT",
    });
    const partially_preserved = pipeline.process_item({
      src: "<b>hello</b>",
      text_type: "TXT",
    });

    expect(line_texts(fully_preserved)).toEqual([]);
    expect(fully_preserved.prepared_lines[0]?.state).toBe("preserved");
    expect(line_texts(partially_preserved)).toEqual(["<b>hello</b>"]);
    expect(partially_preserved.prepared_lines[0]).toMatchObject({
      prefix_segments: [],
      suffix_segments: [],
    });
  });

  it("保护模式关闭时即使自动前后缀保护关闭也不会跳过整行代码", () => {
    const pipeline = new TranslationPrePipeline(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );

    const context = pipeline.process_item({
      src: "<b></b>",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["<b></b>"]);
    expect(context.prepared_lines[0]?.state).toBe("translatable");
  });
});

/**
 * 读取译前产物中的模型输入正文，测试只关心公开 context 内容。
 */
function line_texts(context: ReturnType<TranslationPrePipeline["process_item"]>): string[] {
  return context.prepared_lines
    .filter((line) => line.state === "translatable")
    .map((line) => line.model_text);
}

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支。
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
    ...overrides,
  };
}

/**
 * 生成默认质量快照，避免每个用例重复书写完整规则结构。
 */
function create_quality_snapshot(
  overrides: Partial<TextQualitySnapshot> = {},
): TextQualitySnapshot {
  return {
    glossary_enable: true,
    glossary_entries: [],
    text_preserve_mode: "OFF",
    text_preserve_entries: [],
    pre_replacement_enable: false,
    pre_replacement_entries: [],
    post_replacement_enable: false,
    post_replacement_entries: [],
    translation_prompt_enable: false,
    translation_prompt: "",
    analysis_prompt_enable: false,
    analysis_prompt: "",
    ...overrides,
  };
}
