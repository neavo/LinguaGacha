import { describe, expect, it } from "vitest";

import { format_lifecycle_error, format_ts_lifecycle_log } from "./core-lifecycle-log";

describe("format_ts_lifecycle_log", () => {
  it("使用 Rich 风格的 TS 日志列", () => {
    const date = new Date(2026, 3, 26, 12, 12, 12);

    expect(format_ts_lifecycle_log("正在启动 Python Core - http://127.0.0.1:3107", date)).toBe(
      "[12:12:12] TS       正在启动 Python Core - http://127.0.0.1:3107",
    );
  });
});

describe("format_lifecycle_error", () => {
  it("优先输出 Error message", () => {
    expect(format_lifecycle_error(new Error("启动失败"))).toBe("启动失败");
  });

  it("兼容非 Error 抛出值", () => {
    expect(format_lifecycle_error("失败")).toBe("失败");
  });
});
