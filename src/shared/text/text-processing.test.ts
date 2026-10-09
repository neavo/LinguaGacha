import { QualityRule } from "../../domain/quality";
import { describe, expect, it } from "vitest";

import { read_text_processing_config, read_text_quality_snapshot } from "./text-processing";

describe("text worker snapshots", () => {
  it("只投影文本处理需要的设置字段", () => {
    expect(
      read_text_processing_config({
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
      read_text_processing_config({
        source_language: "INVALID",
        target_language: "ZH",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.unknown_source_language_code" }));
    expect(() =>
      read_text_processing_config({
        source_language: "ZH-HANT",
        target_language: "ZH",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.unknown_source_language_code" }));
    expect(() =>
      read_text_processing_config({
        source_language: "JA",
        target_language: "INVALID",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.invalid_target_language" }));
    expect(() =>
      read_text_processing_config({
        source_language: "JA",
        target_language: "ALL",
      }),
    ).toThrowError(expect.objectContaining({ code: "language.unsupported_all_target_language" }));
  });

  it("解析嵌套规则并排除任务无关字段", () => {
    const snapshot = read_text_quality_snapshot({
      quality: {
        glossary: {
          enabled: true,
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
          revision: 9,
        },
        text_preserve: {
          mode: "CUSTOM",
          entries: [{ entry_id: "italic", src: "<i>", dst: "丢弃" }],
        },
        pre_replacement: { enabled: true, entries: [{ entry_id: "pre", src: "A", dst: "B" }] },
        post_replacement: { enabled: true, entries: [{ entry_id: "post", src: "B", dst: "C" }] },
      },
      prompts: { translation: { enabled: true, text: "翻译提示", revision: 7 } },
      unrelated: "ignored",
    });
    expect(snapshot).toEqual({
      glossary_enable: true,
      glossary_entries: [
        { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false },
      ],
      text_preserve_mode: "custom",
      text_preserve_entries: [{ entry_id: "italic", src: "<i>", info: "" }],
      pre_replacement_enable: true,
      pre_replacement_entries: [
        { entry_id: "pre", src: "A", dst: "B", regex: false, case_sensitive: false },
      ],
      post_replacement_enable: true,
      post_replacement_entries: [
        { entry_id: "post", src: "B", dst: "C", regex: false, case_sensitive: false },
      ],
      translation_prompt_enable: true,
      translation_prompt: "翻译提示",
    });
  });

  it("坏规则事实显式失败", () => {
    expect(() =>
      read_text_quality_snapshot({
        quality: { glossary: { entries: [{ entry_id: "invalid", src: "  ", dst: "忽略" }] } },
      }),
    ).toThrow(TypeError);
  });

  it("缺少质量规则 meta 时使用统一领域默认值", () => {
    const snapshot = read_text_quality_snapshot({
      quality: {
        glossary: {
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }],
        },
        text_preserve: {
          entries: [{ entry_id: "italic", src: "<i>", dst: "<i>" }],
        },
      },
    });

    expect(snapshot.glossary_enable).toBe(QualityRule.from_json("glossary").default_enabled);
    expect(snapshot.text_preserve_mode).toBe(QualityRule.from_json("text_preserve").default_mode);
    expect(snapshot.pre_replacement_enable).toBe(
      QualityRule.from_json("pre_replacement").default_enabled,
    );
    expect(snapshot.post_replacement_enable).toBe(
      QualityRule.from_json("post_replacement").default_enabled,
    );
  });
});
