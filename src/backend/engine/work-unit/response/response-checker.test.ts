import { describe, expect, it } from "vitest";

import { ResponseChecker } from "./response-checker";

describe("响应检查器", () => {
  it("item 内空行不构成失败，只有完整译文为空才失败", () => {
    expect(ResponseChecker.check_item("通过\n缺失", "结果\n", "ZH", false)).toBe("NONE");
    expect(ResponseChecker.check_item("通过", "", "ZH", false)).toBe("FAIL_DATA");
  });

  it("未知源语言显式失败，避免损坏配置静默提交译文", () => {
    expect(() => ResponseChecker.check_item("Hello", "你好", "INVALID", false)).toThrowError(
      expect.objectContaining({ code: "language.unknown_source_language_code" }),
    );
  });
});
