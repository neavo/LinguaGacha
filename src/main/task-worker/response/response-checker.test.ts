import { describe, expect, it } from "vitest";

import type { TextProcessingConfig, TextQualitySnapshot } from "../../../shared/text/text-types";
import { ResponseChecker } from "./response-checker";

describe("ResponseChecker", () => {
  it("响应检查能识别退化、行数错误和日文残留", () => {
    const config = create_config();
    const quality_snapshot = create_quality_snapshot();

    expect(
      ResponseChecker.check(["原文"], ["译文"], "TXT", config, quality_snapshot, 0, true),
    ).toEqual(["FAIL_DEGRADATION"]);
    expect(
      ResponseChecker.check(["こんにちは"], [], "TXT", config, quality_snapshot, 0, false),
    ).toEqual(["FAIL_DATA"]);
    expect(
      ResponseChecker.check(
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
      ResponseChecker.check(
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
      ResponseChecker.check(
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
 * 生成响应检查默认配置，测试通过 overrides 聚焦单个规则分支。
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
