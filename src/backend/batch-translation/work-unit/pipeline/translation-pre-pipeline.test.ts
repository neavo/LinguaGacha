import { describe, expect, it } from "vitest";

import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import { TranslationPrePipeline } from "./translation-pre-pipeline";

describe("TranslationPrePipeline", () => {
  it("混合保护行和可翻译行时产出完整 item 文本", () => {
    const context = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    ).process_item(
      {
        src: "<skip>\nhello\n\nworld",
        text_type: "TXT",
      },
      4,
      9,
    );
    expect(context.request_item).toMatchObject({
      request_id: 9,
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

    expect(context.request_item?.text_src).toBe(source_text);
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

    expect(pipeline.process_item({ src: "hello", text_type: "TXT" }).request_item?.text_src).toBe(
      "你好",
    );
  });

  it("带姓名的 item 不向模型输入注入姓名前缀", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item({
      src: "こんにちは",
      name_src: ["Alice"],
      text_type: "TXT",
    });

    expect(context.request_item?.text_src).toBe("こんにちは");
    expect(context.request_item?.actor_src).toBe("Alice");
  });

  it("在 work unit 内按上文、姓名和正文顺序投影文本引用", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());
    const precedings = pipeline.project_precedings([
      { src: "上文 https://example.com", text_type: "TXT" },
    ]);
    const context = pipeline.process_item({
      src: "查看 image.png",
      name_src: "data:image/png;base64,AAAA",
      text_type: "TXT",
    });

    expect(precedings[0]?.src).toBe("上文 lg-uri/0");
    expect(context.request_item).toMatchObject({
      text_src: "查看 lg-uri/2",
      actor_src: "lg-uri/1",
    });
    expect(context.reference_mappings).toEqual([{ token: "lg-uri/2", value: "image.png" }]);
    expect(context.actor_reference_mappings).toEqual([
      { token: "lg-uri/1", value: "data:image/png;base64,AAAA" },
    ]);
    expect(context.samples).toEqual(["lg-uri/1", "lg-uri/2"]);
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

    expect(context.request_item?.text_src).toBe("宝條直希");
    expect(context.prepared_lines[0]?.state).toBe("translatable");
  });

  it("完全保护条目跳过请求，混合正文保留标签", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
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

    expect(fully_preserved.request_item).toBeNull();
    expect(fully_preserved.prepared_lines[0]?.state).toBe("preserved");
    expect(fully_preserved.samples).toEqual(["<b>", "</b>"]);
    expect(partially_preserved.request_item?.text_src).toBe("<b>hello</b>");
  });

  it("保护模式关闭时自定义规则不参与整行保护判断", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
        text_preserve_entries: [{ src: "<[^>]+>", info: "" }],
      }),
    );

    const context = pipeline.process_item({
      src: "<b></b>",
      text_type: "TXT",
    });

    expect(context.request_item?.text_src).toBe("<b></b>");
    expect(context.prepared_lines[0]?.state).toBe("translatable");
  });
});

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支。
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
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

    ...overrides,
  };
}
