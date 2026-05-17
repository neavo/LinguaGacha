import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const try_show_native_error_dialog = vi.fn();
type ProcessListener = (...args: unknown[]) => void;

vi.mock("../../native/shell/native-error-dialog", () => {
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

  it("未处理 rejection 会提示用户并进入 Core 收尾退出路径", async () => {
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const quit_after_core_shutdown = vi.fn().mockResolvedValue(undefined);
    const { install_main_fatal_error_handler } = await import("./main-fatal-error-handler");

    install_main_fatal_error_handler({
      isAppShutdownInProgress: () => false,
      quitAfterCoreShutdown: quit_after_core_shutdown,
    });
    process.emit("unhandledRejection", "boom", Promise.resolve());
    await Promise.resolve();

    expect(stderr_write).toHaveBeenCalledWith("[fatal] unhandledRejection: boom\n");
    expect(try_show_native_error_dialog).toHaveBeenCalledWith(
      "LinguaGacha 已遇到致命错误",
      "已写入诊断日志，应用将退出。",
    );
    expect(quit_after_core_shutdown).toHaveBeenCalledWith(1);
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
