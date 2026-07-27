import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const try_show_native_error_dialog = vi.fn();
type ProcessListener = (...args: unknown[]) => void;

vi.mock("./native-error-dialog", () => {
  return {
    try_show_native_error_dialog,
  };
});

describe("install_main_fatal_error_handler", () => {
  const initial_unhandled = process.listeners("unhandledRejection") as ProcessListener[];
  const initial_uncaught = process.listeners("uncaughtException") as ProcessListener[];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    restore_listeners("unhandledRejection", initial_unhandled);
    restore_listeners("uncaughtException", initial_uncaught);
  });

  it("未处理 rejection 会提示用户并进入 Backend 收尾退出路径", async () => {
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const quit_after_backend_shutdown = vi.fn().mockResolvedValue(undefined);
    const { install_main_fatal_error_handler } = await import("./main-fatal-error-handler");

    install_main_fatal_error_handler({
      isAppShutdownInProgress: () => false,
      quitAfterBackendShutdown: quit_after_backend_shutdown,
    });
    process.emit("unhandledRejection", "boom", Promise.resolve());
    await Promise.resolve();

    expect(stderr_write).toHaveBeenCalledWith("[fatal] unhandledRejection: boom\n");
    expect(try_show_native_error_dialog).toHaveBeenCalledWith(
      "LinguaGacha 已遇到致命错误",
      "已写入诊断日志，应用将退出。",
    );
    expect(quit_after_backend_shutdown).toHaveBeenCalledWith(1);
  });

  it("结构化 fatal 日志写入失败时仍进入 Backend 收尾退出路径", async () => {
    const diagnostic_failure = new Error("fatal log failed");
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const quit_after_backend_shutdown = vi.fn().mockResolvedValue(undefined);
    const fatal = vi.fn(() => {
      throw diagnostic_failure;
    });
    const { set_electron_main_log_manager } = await import("../../backend/log/log-bridge");
    set_electron_main_log_manager({
      debug: vi.fn(),
      error: vi.fn(),
      fatal,
      warning: vi.fn(),
    } as never);
    const { install_main_fatal_error_handler } = await import("./main-fatal-error-handler");

    try {
      install_main_fatal_error_handler({
        isAppShutdownInProgress: () => false,
        quitAfterBackendShutdown: quit_after_backend_shutdown,
      });
      process.emit("unhandledRejection", "boom", Promise.resolve());
      await Promise.resolve();
    } finally {
      set_electron_main_log_manager(null);
    }

    expect(fatal).toHaveBeenCalledTimes(1);
    expect(stderr_write).toHaveBeenCalledWith(expect.stringContaining("fatal log failed"));
    expect(quit_after_backend_shutdown).toHaveBeenCalledWith(1);
  });

  function restore_listeners(
    event_name: "unhandledRejection" | "uncaughtException",
    listeners: ProcessListener[],
  ): void {
    process.removeAllListeners(event_name);
    for (const listener of listeners) {
      process.on(event_name, listener);
    }
  }
});
