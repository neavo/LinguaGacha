import { describe, expect, it } from "vitest";

import { ResponseChecker } from "./response-checker";

describe("响应检查器整体检查", () => {
  it("已对齐译文结果为空时为每行返回数据错误", () => {
    expect(ResponseChecker.check_aligned(["原文1", "原文2"], ["", ""], "ZH")).toEqual([
      "FAIL_DATA",
      "FAIL_DATA",
    ]);
  });

  it("只把非空原文对应的空译文标记为逐行错误", () => {
    expect(ResponseChecker.check_aligned(["通过", "缺失", "　"], ["结果", "", ""], "ZH")).toEqual([
      "NONE",
      "LINE_ERROR_EMPTY_LINE",
      "NONE",
    ]);
  });

  it("未知源语言显式失败，避免损坏配置静默提交译文", () => {
    expect(() => ResponseChecker.check_aligned(["Hello"], ["你好"], "INVALID")).toThrowError(
      expect.objectContaining({ code: "language.unknown_source_language_code" }),
    );
  });
});
