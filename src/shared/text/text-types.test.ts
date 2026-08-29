import { describe, expect, it } from "vitest";

import { TextProcessingConfigTool, TextQualitySnapshotTool } from "./text-types";

describe("text worker snapshots", () => {
  it("只投影文本处理需要的设置字段", () => {
    expect(
      TextProcessingConfigTool.from_api_value({
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: false,
        auto_process_prefix_suffix_preserved_text: true,
        unrelated: "ignored",
      }),
    ).toEqual({
      source_language: "JA",
      target_language: "ZH",
      clean_ruby: false,
      auto_process_prefix_suffix_preserved_text: true,
    });
  });

  it("恢复文本处理配置时拒绝无效语言", () => {
    expect(() =>
      TextProcessingConfigTool.from_api_value({
        source_language: "INVALID",
        target_language: "ZH",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.unknown_source_language_code" }));
    expect(() =>
      TextProcessingConfigTool.from_api_value({
        source_language: "JA",
        target_language: "INVALID",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.invalid_target_language" }));
    expect(() =>
      TextProcessingConfigTool.from_api_value({
        source_language: "JA",
        target_language: "ALL",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.unsupported_all_target_language" }));
  });

  it("从嵌套质量载荷精确投影 worker 所需字段", () => {
    expect(
      TextQualitySnapshotTool.from_api_value({
        quality: {
          glossary: {
            enabled: true,
            entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
            revision: 9,
          },
        },
        prompts: {
          translation: {
            enabled: true,
            text: "翻译提示",
            revision: 7,
          },
        },
        unrelated: "ignored",
      }),
    ).toEqual({
      glossary_enable: true,
      glossary_entries: [
        { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false },
      ],
      text_preserve_mode: "smart",
      text_preserve_entries: [],
      pre_replacement_enable: false,
      pre_replacement_entries: [],
      post_replacement_enable: false,
      post_replacement_entries: [],
      translation_prompt_enable: true,
      translation_prompt: "翻译提示",
      analysis_prompt_enable: false,
      analysis_prompt: "",
    });
  });
});
