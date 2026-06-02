import { describe, expect, it } from "vitest";

import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import { TranslationPrePipeline } from "./translation-pre-pipeline";

describe("TranslationPrePipeline", () => {
  it("记录并剥离每行头尾空白", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item({
      src: "  hello\t ",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["hello"]);
    expect(context.leading_whitespace_by_line).toEqual(new Map([[0, "  "]]));
    expect(context.trailing_whitespace_by_line).toEqual(new Map([[0, "\t "]]));
  });

  it("抽取保护前后缀并记录恢复所需的位置", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );

    const context = pipeline.process_item({
      src: "  \\n[1]こんにちは\\n[2]  ",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["こんにちは"]);
    expect(context.prefix_codes_by_line).toEqual(new Map([[0, ["\\n[1]"]]]));
    expect(context.suffix_codes_by_line).toEqual(new Map([[0, ["\\n[2]"]]]));
  });

  it("小写 smart 模式使用共享预置规则保护脚本控制码", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "smart",
      }),
    );

    const context = pipeline.process_item({
      src: "@12こんにちは",
      text_type: "WOLF",
    });

    expect(line_texts(context)).toEqual(["こんにちは"]);
    expect(context.prefix_codes_by_line).toEqual(new Map([[0, ["@12"]]]));
  });

  it("小写 off 模式不会误用快照里的自定义保护规则", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "off",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );

    const context = pipeline.process_item({
      src: "\\n[1]こんにちは",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["\\n[1]こんにちは"]);
  });

  it("正规化保持旧格式全角和半角片假名映射", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item({
      src: "ＡＢ１２ｱｲ",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["AB12アイ"]);
  });

  it("普通替换按字面量写入并避免 JS 替换占位符误生效", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        pre_replacement_enable: true,
        pre_replacement_entries: [
          {
            src: "ABC",
            dst: "$&",
            regex: false,
            case_sensitive: false,
          },
        ],
      }),
    );

    const context = pipeline.process_item({
      src: "abc AbC",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["$& $&"]);
  });

  it("正则替换兼容历史反向引用并保留 JS 美元占位字面量", () => {
    const pipeline = new TranslationPrePipeline(
      create_config(),
      create_quality_snapshot({
        pre_replacement_enable: true,
        pre_replacement_entries: [
          {
            src: "(A)(B)",
            dst: "\\2\\1-$&",
            regex: true,
            case_sensitive: false,
          },
        ],
      }),
    );

    const context = pipeline.process_item({
      src: "ab",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["ba-$&"]);
  });

  it("带姓名的 item 不向模型输入注入姓名前缀", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item({
      src: "こんにちは",
      name_src: ["Alice"],
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["こんにちは"]);
    expect(context.lines[0]?.actor_src).toBe("Alice");
  });

  it("空 item 会返回同一形状的空上下文", () => {
    const pipeline = new TranslationPrePipeline(create_config(), create_quality_snapshot());

    const context = pipeline.process_item(null);

    expect(line_texts(context)).toEqual([]);
    expect(context.samples).toEqual([]);
    expect(context.valid_line_indexes).toEqual(new Set());
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
    expect(context.valid_line_indexes).toEqual(new Set([1]));
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
    expect(context.valid_line_indexes).toEqual(new Set([0]));
  });

  it("关闭自动前后缀保护时保留原文并跳过完全保护行", () => {
    const pipeline = new TranslationPrePipeline(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>" }],
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
    expect(fully_preserved.valid_line_indexes).toEqual(new Set());
    expect(line_texts(partially_preserved)).toEqual(["<b>hello</b>"]);
    expect(partially_preserved.prefix_codes_by_line).toEqual(new Map());
    expect(partially_preserved.suffix_codes_by_line).toEqual(new Map());
  });

  it("关闭自动前后缀保护时只跳过混合文本里的完全保护行", () => {
    const pipeline = new TranslationPrePipeline(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "<[^>]+>" }],
      }),
    );

    const context = pipeline.process_item({
      src: "<b></b>\nhello\n<i></i>",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["hello"]);
    expect(context.valid_line_indexes).toEqual(new Set([1]));
  });

  it("保护模式关闭时即使自动前后缀保护关闭也不会跳过整行代码", () => {
    const pipeline = new TranslationPrePipeline(
      create_config({ auto_process_prefix_suffix_preserved_text: false }),
      create_quality_snapshot({
        text_preserve_mode: "OFF",
        text_preserve_entries: [{ src: "<[^>]+>" }],
      }),
    );

    const context = pipeline.process_item({
      src: "<b></b>",
      text_type: "TXT",
    });

    expect(line_texts(context)).toEqual(["<b></b>"]);
    expect(context.valid_line_indexes).toEqual(new Set([0]));
  });
});

/**
 * 读取译前产物中的模型输入正文，测试只关心公开 context 内容。
 */
function line_texts(context: ReturnType<TranslationPrePipeline["process_item"]>): string[] {
  return context.lines.map((line) => line.text_src);
}

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支。
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    check_kana_residue: true,
    check_hangeul_residue: true,
    check_similarity: true,
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
