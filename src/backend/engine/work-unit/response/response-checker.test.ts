import { describe, expect, it } from "vitest";

import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import { ResponseChecker } from "./response-checker";

describe("响应检查器整体检查", () => {
  it("流式退化时为每行返回退化错误", () => {
    expect(
      check_response(["原文1", "原文2"], ["译文1", "译文2"], {
        stream_degraded: true,
      }),
    ).toEqual(["FAIL_DEGRADATION", "FAIL_DEGRADATION"]);
  });

  it("译文结果为空时为每行返回数据错误", () => {
    expect(check_response(["原文1", "原文2"], ["", ""])).toEqual(["FAIL_DATA", "FAIL_DATA"]);
    expect(check_response(["原文1", "原文2"], [])).toEqual(["FAIL_DATA", "FAIL_DATA"]);
  });

  it("单条重试达到阈值时跳过后续校验", () => {
    expect(check_response(["原文"], ["任意内容"], { item_retry_count: 2 })).toEqual(["NONE"]);
  });

  it("原文和译文行数不一致时为每行返回行数错误", () => {
    expect(check_response(["a", "b"], ["1"])).toEqual(["FAIL_LINE_COUNT", "FAIL_LINE_COUNT"]);
  });

  it("整体检查不会把假名残留作为独立错误", () => {
    expect(check_response(["こんにちは"], ["テスト"])).toEqual(["NONE"]);
  });

  it("逐行检查通过时返回无错误", () => {
    expect(check_response(["こんにちは"], ["你好"])).toEqual(["NONE"]);
  });
});

describe("响应检查器逐行规则", () => {
  it("原文非空且译文为空时返回空行错误", () => {
    expect(
      check_lines(["有内容"], [""], {
        config: create_config({ source_language: "ZH", target_language: "EN" }),
      }),
    ).toEqual(["LINE_ERROR_EMPTY_LINE"]);
  });

  it("规则过滤命中时跳过质量检查", () => {
    expect(check_lines(["12345"], ["任意译文"])).toEqual(["NONE"]);
  });

  it("语言过滤命中时跳过质量检查", () => {
    expect(check_lines(["Hello World"], ["任何译文"])).toEqual(["NONE"]);
  });

  it("强制翻译行不被规则或语言过滤短路", () => {
    expect(
      check_lines(["voice.ogg", "Hello World"], ["voice.ogg", "Hello World"], {
        config: create_config({
          source_language: "JA",
          target_language: "EN",
        }),
        skip_internal_filter_by_line: [true, true],
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY", "LINE_ERROR_SIMILARITY"]);
  });

  it("日文源语言的假名残留不会独立失败", () => {
    expect(
      check_lines(["こんにちは"], ["テスト"], {
        config: create_config({
          source_language: "JA",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["NONE"]);
  });

  it("韩文源语言的谚文残留不会独立失败", () => {
    expect(
      check_lines(["안녕하세요"], ["테스트"], {
        config: create_config({
          source_language: "KO",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["NONE"]);
  });

  it("通用语言对中原文译文相同会返回相似错误", () => {
    expect(
      check_lines(["same text"], ["same text"], {
        config: create_config({ source_language: "EN", target_language: "ZH" }),
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY"]);
  });

  it("相似条件不满足时返回无错误", () => {
    expect(
      check_lines(["alpha"], ["beta"], {
        config: create_config({ source_language: "EN", target_language: "ZH" }),
      }),
    ).toEqual(["NONE"]);
  });

  it("日翻中相似检查要求译文包含假名", () => {
    expect(
      check_lines(["東京"], ["東京"], {
        config: create_config({
          source_language: "JA",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["NONE"]);
  });

  it("日翻中相似且译文包含假名时返回相似错误", () => {
    expect(
      check_lines(["東京"], ["東京あ"], {
        config: create_config({
          source_language: "JA",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY"]);
  });

  it("韩翻中相似且译文包含谚文时返回相似错误", () => {
    expect(
      check_lines(["韓國"], ["韓國한"], {
        config: create_config({
          source_language: "KO",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY"]);
  });

  it("韩翻中相似但译文不含谚文时返回无错误", () => {
    expect(
      check_lines(["韓國"], ["韓國"], {
        config: create_config({
          source_language: "KO",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["NONE"]);
  });

  it("相似检查前会剥离保护片段", () => {
    expect(
      check_lines(["こんにちは<保護>"], ["こんにちは<保護>"], {
        quality_snapshot: create_quality_snapshot({
          text_preserve_mode: "custom",
          text_preserve_entries: [{ src: "<[^>]+>" }],
        }),
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY"]);
  });

  it("保护片段不一致时仍按剥离后的可见文本继续检查", () => {
    expect(
      check_response(["@12こんにちは"], ["@13こんにちは"], {
        text_type: "WOLF",
        quality_snapshot: create_quality_snapshot({
          text_preserve_mode: "smart",
        }),
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY"]);
  });

  it("保护规则关闭时不会比较保护片段差异", () => {
    expect(
      check_lines(["[A]"], ["[B]"], {
        config: create_config({
          source_language: "ZH",
          target_language: "EN",
        }),
        quality_snapshot: create_quality_snapshot({
          text_preserve_mode: "off",
          text_preserve_entries: [{ src: "\\[[^\\]]+\\]" }],
        }),
      }),
    ).toEqual(["NONE"]);
  });
});

describe("响应检查器任意源语言", () => {
  it("任意源语言不会因语言过滤短路相似检查", () => {
    expect(
      check_lines(["Hello World"], ["Hello World"], {
        config: create_config({
          source_language: "ALL",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["LINE_ERROR_SIMILARITY"]);
  });

  it("任意源语言下正常翻译仍能通过检查", () => {
    expect(
      check_lines(["こんにちは"], ["你好"], {
        config: create_config({
          source_language: "ALL",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["NONE"]);
  });

  it("任意源语言下空译文仍返回空行错误", () => {
    expect(
      check_lines(["Hello World"], [""], {
        config: create_config({
          source_language: "ALL",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["LINE_ERROR_EMPTY_LINE"]);
  });

  it("任意源语言下空白原文仍按规则过滤短路", () => {
    expect(
      check_lines(["", "　"], ["", "任意译文"], {
        config: create_config({
          source_language: "ALL",
          target_language: "ZH",
        }),
      }),
    ).toEqual(["NONE", "NONE"]);
  });
});

function check_response(
  srcs: string[],
  dsts: string[],
  options: {
    text_type?: string;
    config?: TextProcessingConfig;
    quality_snapshot?: TextQualitySnapshot;
    item_retry_count?: number;
    stream_degraded?: boolean;
    skip_internal_filter_by_line?: boolean[];
  } = {},
): string[] {
  return ResponseChecker.check(
    srcs,
    dsts,
    options.text_type ?? "NONE",
    options.config ?? create_config(),
    options.quality_snapshot ?? create_quality_snapshot(),
    options.item_retry_count ?? 0,
    options.stream_degraded ?? false,
    options.skip_internal_filter_by_line ?? [],
  );
}

function check_lines(
  srcs: string[],
  dsts: string[],
  options: {
    text_type?: string;
    config?: TextProcessingConfig;
    quality_snapshot?: TextQualitySnapshot;
    skip_internal_filter_by_line?: boolean[];
  } = {},
): string[] {
  return ResponseChecker.check_lines(
    srcs,
    dsts,
    options.text_type ?? "NONE",
    options.config ?? create_config(),
    options.quality_snapshot ?? create_quality_snapshot(),
    options.skip_internal_filter_by_line ?? [],
  );
}

function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
    ...overrides,
  };
}

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
