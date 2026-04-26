import { describe, expect, it } from "vitest";

import {
  format_core_shutdown_completed_log,
  format_lifecycle_error,
  format_ts_lifecycle_log,
} from "./core-lifecycle-log";

describe("format_ts_lifecycle_log", () => {
  it("使用 Rich 风格的 TS 日志列", () => {
    const date = new Date(2026, 3, 26, 12, 12, 12);

    expect(format_ts_lifecycle_log("Python Core 正在启动 …", date)).toBe(
      "[12:12:12] TS       Python Core 正在启动 …",
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

describe("format_core_shutdown_completed_log", () => {
  it("输出优雅退出结果", () => {
    expect(format_core_shutdown_completed_log(33200, false)).toBe(
      "Python Core PID[33200] 实例优雅退出 …",
    );
  });

  it("输出强制退出结果", () => {
    expect(format_core_shutdown_completed_log(33200, true)).toBe(
      "Python Core PID[33200] 实例强制关闭 …",
    );
  });
});
