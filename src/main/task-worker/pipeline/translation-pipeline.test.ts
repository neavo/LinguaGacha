import { describe, expect, it } from "vitest";

import type {
  TextProcessingConfig,
  TextQualitySnapshot,
  TextTaskItemRecord,
} from "../../../shared/text/text-types";
import { TranslationPostPipeline } from "./translation-post-pipeline";
import { TranslationPrePipeline } from "./translation-pre-pipeline";

describe("翻译文本 pipeline", () => {
  it("译前抽取保护前后缀并在译后恢复原始空白", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );
    const context = pipeline.pre.process_item({
      src: "  \\n[1]こんにちは\\n[2]  ",
      text_type: "TXT",
    });

    const result = pipeline.post.process_item(context, ["你好"]);

    expect(context.srcs).toEqual(["こんにちは"]);
    expect(result.dst).toBe("  \\n[1]你好\\n[2]  ");
  });

  it("小写 smart 模式使用共享预置规则保护脚本控制码", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "smart",
      }),
    );
    const context = pipeline.pre.process_item({
      src: "@12こんにちは",
      text_type: "WOLF",
    });

    const result = pipeline.post.process_item(context, ["你好"]);

    expect(context.srcs).toEqual(["こんにちは"]);
    expect(result.dst).toBe("@12你好");
  });

  it("小写 off 模式不会误用快照里的自定义保护规则", () => {
    const pipeline = create_pipeline_pair(
      create_config(),
      create_quality_snapshot({
        text_preserve_mode: "off",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );

    const context = pipeline.pre.process_item({
      src: "\\n[1]こんにちは",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["\\n[1]こんにちは"]);
  });

  it("译前正规化保持旧格式全角和半角片假名映射", () => {
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());

    const context = pipeline.pre.process_item({
      src: "ＡＢ１２ｱｲ",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["AB12アイ"]);
  });

  it("普通替换按字面量写入并避免 JS 替换占位符误生效", () => {
    const pipeline = create_pipeline_pair(
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

    const context = pipeline.pre.process_item({
      src: "abc AbC",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["$& $&"]);
  });

  it("正则替换兼容历史反向引用并保留 JS 美元占位字面量", () => {
    const pipeline = create_pipeline_pair(
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

    const context = pipeline.pre.process_item({
      src: "ab",
      text_type: "TXT",
    });

    expect(context.srcs).toEqual(["ba-$&"]);
  });

  it("姓名注入和译后姓名抽取只影响带 name_src 的 item", () => {
    const item: TextTaskItemRecord = {
      src: "こんにちは",
      name_src: ["Alice"],
      text_type: "TXT",
    };
    const pipeline = create_pipeline_pair(create_config(), create_quality_snapshot());

    const context = pipeline.pre.process_item(item);
    const result = pipeline.post.process_item(context, ["【爱丽丝】你好"]);

    expect(context.srcs).toEqual(["【Alice】こんにちは"]);
    expect(result).toEqual({ name: "爱丽丝", dst: "你好" });
  });
});

/**
 * 构造译前和译后 pipeline，确保同一用例共享同一批配置快照
 */
function create_pipeline_pair(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
  return {
    pre: new TranslationPrePipeline(config, quality_snapshot),
    post: new TranslationPostPipeline(config, quality_snapshot),
  };
}

/**
 * 生成翻译 pipeline 默认配置，测试通过 overrides 聚焦单个规则分支
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
 * 生成默认质量快照，避免每个用例重复书写完整规则结构
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
