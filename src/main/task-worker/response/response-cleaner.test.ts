import { describe, expect, it } from "vitest";

import { ResponseCleaner } from "./response-cleaner";

describe("响应清洗器", () => {
  it("空回复提取 why 时返回空正文和空解释", () => {
    expect(ResponseCleaner.extract_why_from_response("")).toEqual({
      cleaned_response_result: "",
      why_text: "",
    });
  });

  it("剥离多个 why 块并按行合并非空解释", () => {
    const result = ResponseCleaner.extract_why_from_response(
      "start\n<why> first </why>\nbody\n<why>second</why>",
    );

    expect(result).toEqual({
      cleaned_response_result: "start\n\nbody\n",
      why_text: "first\nsecond",
    });
  });

  it("没有 why 块时保留原始正文并返回空解释", () => {
    expect(ResponseCleaner.extract_why_from_response("plain text")).toEqual({
      cleaned_response_result: "plain text",
      why_text: "",
    });
    expect(ResponseCleaner.has_why_block("plain text")).toBe(false);
  });

  it("识别存在的 why 块", () => {
    expect(ResponseCleaner.has_why_block("<why>原因</why>")).toBe(true);
  });

  it("空文本压缩空行时保持空文本", () => {
    expect(ResponseCleaner.normalize_blank_lines("")).toBe("");
  });

  it("连续空行压缩成单个空行", () => {
    expect(ResponseCleaner.normalize_blank_lines("a\n\n\nb\n \n\nc")).toBe("a\n\nb\n\nc");
  });

  it("两个非空文本块按换行拼接", () => {
    expect(ResponseCleaner.merge_text_blocks("first", "second")).toBe("first\nsecond");
  });

  it("只保留非空的第二个文本块", () => {
    expect(ResponseCleaner.merge_text_blocks("", "second")).toBe("second");
  });

  it("两个文本块都为空时返回空文本", () => {
    expect(ResponseCleaner.merge_text_blocks("", "")).toBe("");
  });
});
