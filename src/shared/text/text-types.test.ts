import { describe, expect, it } from "vitest";

import { TextProcessingConfigTool, TextQualitySnapshotTool } from "./text-types";

describe("text worker snapshots", () => {
  it("只投影文本处理需要的设置字段", () => {
    expect(
      TextProcessingConfigTool.from_api_value({
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: false,
        unrelated: "ignored",
      }),
    ).toEqual({
      source_language: "JA",
      target_language: "ZH",
      clean_ruby: false,
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
        source_language: "ZH-HANT",
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

  it("从嵌套质量载荷提取任务规则并排除修订信息", () => {
    const snapshot = TextQualitySnapshotTool.from_api_value({
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
    });
    expect(snapshot).toMatchObject({
      glossary_enable: true,
      glossary_entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
      translation_prompt_enable: true,
      translation_prompt: "翻译提示",
    });
    expect(snapshot).not.toHaveProperty("glossary_revision");
    expect(snapshot).not.toHaveProperty("translation_prompt_revision");
    expect(snapshot).not.toHaveProperty("unrelated");
  });
});
