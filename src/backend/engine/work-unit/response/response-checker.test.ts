import { describe, expect, it } from "vitest";

import type { TextProcessingConfig } from "../../../../shared/text/text-types";
import { ResponseChecker } from "./response-checker";

describe("响应检查器整体检查", () => {
  it("已对齐译文结果为空时为每行返回数据错误", () => {
    expect(check_response(["原文1", "原文2"], ["", ""])).toEqual(["FAIL_DATA", "FAIL_DATA"]);
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

  it("相同源译文不再阻塞提交", () => {
    expect(
      check_lines(["same text"], ["same text"], {
        config: create_config({ source_language: "EN", target_language: "ZH" }),
      }),
    ).toEqual(["NONE"]);
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
});

describe("响应检查器任意源语言", () => {
  it("任意源语言下相同源译文仍能通过检查", () => {
    expect(
      check_lines(["Hello World"], ["Hello World"], {
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

/**
 * 走已对齐响应入口，确认 checker 不再承担重试阈值裁决。
 */
function check_response(
  srcs: string[],
  dsts: string[],
  options: {
    config?: TextProcessingConfig;
    skip_internal_filter_by_line?: boolean[];
  } = {},
): string[] {
  return ResponseChecker.check_aligned(
    srcs,
    dsts,
    options.config ?? create_config(),
    options.skip_internal_filter_by_line ?? [],
  );
}

/**
 * 直接测试逐行质量规则，避免整体响应入口掩盖单行分支。
 */
function check_lines(
  srcs: string[],
  dsts: string[],
  options: {
    config?: TextProcessingConfig;
    skip_internal_filter_by_line?: boolean[];
  } = {},
): string[] {
  return ResponseChecker.check_lines(
    srcs,
    dsts,
    options.config ?? create_config(),
    options.skip_internal_filter_by_line ?? [],
  );
}

/**
 * 构造最小文本处理配置，测试只覆盖被声明的语言差异。
 */
function create_config(overrides: Partial<TextProcessingConfig> = {}): TextProcessingConfig {
  return {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
    ...overrides,
  };
}
