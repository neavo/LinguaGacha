import { describe, expect, it } from "vitest";

import { ResponseCleaner } from "./response-cleaner";

describe("响应清洗器", () => {
  it("剥离多个规则分析块并按行合并非空内容", () => {
    const result = ResponseCleaner.extract_rule_analysis_from_response(
      "start\n<why> first </why>\nbody\n<why>second</why>",
    );

    expect(result).toEqual({
      cleaned_response_result: "start\n\nbody\n",
      rule_analysis_text: "first\nsecond",
    });
  });

  it("没有规则分析块时保留原始正文并返回空分析", () => {
    expect(ResponseCleaner.extract_rule_analysis_from_response("plain text")).toEqual({
      cleaned_response_result: "plain text",
      rule_analysis_text: "",
    });
    expect(ResponseCleaner.has_rule_analysis_block("plain text")).toBe(false);
    expect(ResponseCleaner.has_rule_analysis_block("<why>原因</why>")).toBe(true);
  });

  it("连续空行压缩成单个空行", () => {
    expect(ResponseCleaner.normalize_blank_lines("")).toBe("");
    expect(ResponseCleaner.normalize_blank_lines("a\n\n\nb\n \n\nc")).toBe("a\n\nb\n\nc");
  });
});
