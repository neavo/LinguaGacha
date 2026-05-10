import { describe, expect, it } from "vitest";

import { TextProcessor, TextResponseChecker } from "./text-processor";
import type { TextProcessingConfig, TextQualitySnapshot, TextTaskItemRecord } from "./text-types";

describe("TextProcessor", () => {
  it("译前抽取保护前后缀并在译后恢复原始空白", () => {
    const processor = new TextProcessor(
      create_config(),
      {
        src: "  \\n[1]こんにちは\\n[2]  ",
        text_type: "TXT",
      },
      create_quality_snapshot({
        text_preserve_mode: "CUSTOM",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );

    processor.pre_process();
    const result = processor.post_process(["你好"]);

    expect(processor.srcs).toEqual(["こんにちは"]);
    expect(result.dst).toBe("  \\n[1]你好\\n[2]  ");
  });

  it("小写 smart 模式使用共享预置规则保护脚本控制码", () => {
    const processor = new TextProcessor(
      create_config(),
      {
        src: "@12こんにちは",
        text_type: "WOLF",
      },
      create_quality_snapshot({
        text_preserve_mode: "smart",
      }),
    );

    processor.pre_process();
    const result = processor.post_process(["你好"]);

    expect(processor.srcs).toEqual(["こんにちは"]);
    expect(result.dst).toBe("@12你好");
  });

  it("小写 off 模式不会误用快照里的自定义保护规则", () => {
    const processor = new TextProcessor(
      create_config(),
      {
        src: "\\n[1]こんにちは",
        text_type: "TXT",
      },
      create_quality_snapshot({
        text_preserve_mode: "off",
        text_preserve_entries: [{ src: "\\\\n\\[\\d+\\]" }],
      }),
    );

    processor.pre_process();

    expect(processor.srcs).toEqual(["\\n[1]こんにちは"]);
  });

  it("译前正规化保持旧格式全角和半角片假名映射", () => {
    const processor = new TextProcessor(
      create_config(),
      {
        src: "ＡＢ１２ｱｲ",
        text_type: "TXT",
      },
      create_quality_snapshot(),
    );

    processor.pre_process();

    expect(processor.srcs).toEqual(["AB12アイ"]);
  });

  it("普通替换按字面量写入并避免 JS 替换占位符误生效", () => {
    const processor = new TextProcessor(
      create_config(),
      {
        src: "abc AbC",
        text_type: "TXT",
      },
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

    processor.pre_process();

    expect(processor.srcs).toEqual(["$& $&"]);
  });

  it("正则替换兼容 历史反向引用并保留 JS 美元占位字面量", () => {
    const processor = new TextProcessor(
      create_config(),
      {
        src: "ab",
        text_type: "TXT",
      },
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

    processor.pre_process();

    expect(processor.srcs).toEqual(["ba-$&"]);
  });

  it("姓名注入和译后姓名抽取只影响带 name_src 的 item", () => {
    const item: TextTaskItemRecord = {
      src: "こんにちは",
      name_src: ["Alice"],
      text_type: "TXT",
    };
    const processor = new TextProcessor(create_config(), item, create_quality_snapshot());

    processor.pre_process();
    expect(processor.srcs).toEqual(["【Alice】こんにちは"]);

    const result = processor.post_process(["【爱丽丝】你好"]);

    expect(result).toEqual({ name: "爱丽丝", dst: "你好" });
  });

  it("响应检查能识别退化、行数错误和日文残留", () => {
    const config = create_config();
    const quality_snapshot = create_quality_snapshot();

    expect(
      TextResponseChecker.check(["原文"], ["译文"], "TXT", config, quality_snapshot, 0, true),
    ).toEqual(["FAIL_DEGRADATION"]);
    expect(
      TextResponseChecker.check(["こんにちは"], [], "TXT", config, quality_snapshot, 0, false),
    ).toEqual(["FAIL_DATA"]);
    expect(
      TextResponseChecker.check(
        ["こんにちは"],
        ["こんにちは"],
        "TXT",
        config,
        quality_snapshot,
        0,
        false,
      ),
    ).toEqual(["LINE_ERROR_KANA"]);
  });

  it("响应检查按传入 text_type 使用 smart 保护规则剥离控制码", () => {
    const config = create_config();
    const quality_snapshot = create_quality_snapshot({
      text_preserve_mode: "smart",
    });

    expect(
      TextResponseChecker.check(
        ["@12こんにちは"],
        ["@12こんにちは"],
        "WOLF",
        config,
        quality_snapshot,
        0,
        false,
      ),
    ).toEqual(["LINE_ERROR_KANA"]);
    expect(
      TextResponseChecker.check(
        ["@12こんにちは"],
        ["@13こんにちは"],
        "WOLF",
        config,
        quality_snapshot,
        0,
        false,
      ),
    ).toEqual(["FAIL_DATA"]);
  });
});

/**
 * 生成 TextProcessor 默认配置，测试通过 overrides 聚焦单个规则分支。
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
