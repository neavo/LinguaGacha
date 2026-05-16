import { afterEach, describe, expect, it, vi } from "vitest";

import { set_electron_main_log_manager } from "../log/log-bridge";
import type { LogManager } from "../log/log-manager";
import {
  format_lifecycle_error,
  format_lifecycle_log,
  write_lifecycle_error,
  write_lifecycle_log,
} from "./lifecycle-log";

afterEach(() => {
  set_electron_main_log_manager(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("format_lifecycle_log", () => {
  it("使用 Rich 风格的主进程日志列", () => {
    const date = new Date(2026, 3, 26, 12, 12, 12);

    expect(format_lifecycle_log("后端服务正在启动 …", date)).toBe(
      "[12:12:12] MAIN     后端服务正在启动 …",
    );
  });
});

describe("write_lifecycle_log", () => {
  it("没有日志管理器时写入主进程 stdout 兜底日志", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 26, 12, 12, 12));
    const stdout_write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    write_lifecycle_log("Core 正在启动");

    expect(stdout_write).toHaveBeenCalledWith("[12:12:12] MAIN     Core 正在启动\n");
  });

  it("存在日志管理器时写入生命周期来源的 info 记录", () => {
    const info = vi.fn();
    set_electron_main_log_manager({ info } as unknown as LogManager);

    write_lifecycle_log("Core 已启动");

    expect(info).toHaveBeenCalledWith("Core 已启动", { source: "main-lifecycle" });
  });
});

describe("write_lifecycle_error", () => {
  it("没有日志管理器时写入主进程 stderr 兜底日志", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 26, 12, 12, 12));
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    write_lifecycle_error("Core 启动失败");

    expect(stderr_write).toHaveBeenCalledWith("[12:12:12] MAIN     Core 启动失败\n");
  });

  it("存在日志管理器时写入生命周期来源的 error 记录", () => {
    const error = vi.fn();
    set_electron_main_log_manager({ error } as unknown as LogManager);

    write_lifecycle_error("Core 启动失败");

    expect(error).toHaveBeenCalledWith("Core 启动失败", { source: "main-lifecycle" });
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
