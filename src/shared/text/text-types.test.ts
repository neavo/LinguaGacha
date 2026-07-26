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

  it("从嵌套质量载荷生成 worker 快照并过滤空规则", () => {
    expect(
      TextQualitySnapshotTool.from_api_value({
        quality: {
          glossary: {
            enabled: true,
            entries: [{ src: "HP", dst: "生命值" }, { src: " " }],
          },
        },
        prompts: {
          translation: {
            enabled: true,
            text: "翻译提示",
          },
        },
      }),
    ).toMatchObject({
      glossary_enable: true,
      glossary_entries: [{ src: "HP", dst: "生命值" }],
      translation_prompt_enable: true,
      translation_prompt: "翻译提示",
    });
  });
});
