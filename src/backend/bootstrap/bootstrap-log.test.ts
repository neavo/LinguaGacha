import { afterEach, describe, expect, it, vi } from "vitest";

import { write_bootstrap_error, write_bootstrap_log } from "./bootstrap-log";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("write_bootstrap_log", () => {
  it("没有日志管理器时写入主进程 stdout 兜底日志", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 26, 12, 12, 12));
    const stdout_write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    write_bootstrap_log("Backend 正在启动");

    expect(stdout_write).toHaveBeenCalledWith("[12:12:12] MAIN     Backend 正在启动\n");
  });
});

describe("write_bootstrap_error", () => {
  it("存在日志管理器时写入生命周期来源的 error 记录", () => {
    const error = vi.fn();
    write_bootstrap_error("Backend 启动失败", { error: new Error("端口占用") }, { error });

    expect(error).toHaveBeenCalledWith(
      "Backend 启动失败",
      expect.objectContaining({
        source: "backend-bootstrap",
        error: expect.objectContaining({
          message: "端口占用",
        }),
      }),
    );
  });
});
