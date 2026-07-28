import { describe, expect, it } from "vitest";

import { format_log_readable_text, normalize_log_level } from "./log";

describe("log 基础模型", () => {
  it("规范化日志等级", () => {
    expect(normalize_log_level("warning")).toBe("warning");
    expect(normalize_log_level("bad")).toBe("info");
  });

  it("按公开顺序拼接日志正文和错误详情", () => {
    expect(
      format_log_readable_text({
        message: "任务失败",
        error: {
          message: "底层失败",
          stack: "Error: 底层失败\n    at run",
        },
      }),
    ).toBe("任务失败\n底层失败\nError: 底层失败\n    at run");
  });
});
