import { describe, expect, it } from "vitest";

import { ResponseCleaner } from "./response-cleaner";

describe("ResponseCleaner", () => {
  it("剥离 why 块并保留解释文本", () => {
    const result = ResponseCleaner.extract_why_from_response('<why>原因</why>\n{"0":"译文"}');

    expect(result).toEqual({
      cleaned_response_result: '\n{"0":"译文"}',
      why_text: "原因",
    });
    expect(ResponseCleaner.has_why_block("<why>原因</why>")).toBe(true);
  });

  it("压缩连续空行并拼接可选文本块", () => {
    expect(ResponseCleaner.normalize_blank_lines("甲\n\n\n乙")).toBe("甲\n\n乙");
    expect(ResponseCleaner.merge_text_blocks("思考", "解释")).toBe("思考\n解释");
  });
});
