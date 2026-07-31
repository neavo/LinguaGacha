import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

const try_show_native_error_dialog = vi.fn();
type ProcessListener = (...args: unknown[]) => void;

vi.mock("./native-error-dialog", () => ({ try_show_native_error_dialog }));

describe("install_main_fatal_error_handler", () => {
  const initial_unhandled = process.listeners("unhandledRejection") as ProcessListener[];
  const initial_uncaught = process.listeners("uncaughtException") as ProcessListener[];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    restore_listeners("unhandledRejection", initial_unhandled);
    restore_listeners("uncaughtException", initial_uncaught);
  });

  it("未处理 rejection 通过 Backend runtime 记录并进入统一退出路径", async () => {
    const record_host_diagnostic = vi.fn(async () => undefined);
    const quit_after_backend_shutdown = vi.fn(async () => undefined);
    const { install_main_fatal_error_handler } = await import("./main-fatal-error-handler");
    install_main_fatal_error_handler({
      isAppShutdownInProgress: () => false,
      quitAfterBackendShutdown: quit_after_backend_shutdown,
      getBackendRuntimeClient: () => ({ recordHostDiagnostic: record_host_diagnostic }),
    });

    process.emit("unhandledRejection", "boom", Promise.resolve());
    await vi.waitFor(() => expect(quit_after_backend_shutdown).toHaveBeenCalledWith(1));

    expect(record_host_diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "fatal",
        messageKey: "app.diagnostic.lifecycle.main_fatal_uncaught",
        error: expect.objectContaining({
          context: expect.objectContaining({ kind: "unhandledRejection", origin: "promise" }),
        }),
      }),
    );
    expect(try_show_native_error_dialog).toHaveBeenCalled();
    expect(record_host_diagnostic.mock.invocationCallOrder[0]).toBeLessThan(
      quit_after_backend_shutdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("runtime 诊断失败时写 stderr，但仍继续退出", async () => {
    const stderr_write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const quit_after_backend_shutdown = vi.fn(async () => undefined);
    const { install_main_fatal_error_handler } = await import("./main-fatal-error-handler");
    install_main_fatal_error_handler({
      isAppShutdownInProgress: () => false,
      quitAfterBackendShutdown: quit_after_backend_shutdown,
      getBackendRuntimeClient: () => ({
        recordHostDiagnostic: async () => {
          throw new Error("fatal log failed");
        },
      }),
    });

    process.emit("unhandledRejection", "boom", Promise.resolve());
    await vi.waitFor(() => expect(quit_after_backend_shutdown).toHaveBeenCalledWith(1));

    expect(stderr_write).toHaveBeenCalledWith(expect.stringContaining("fatal log failed"));
  });
});

function restore_listeners(
  event_name: "unhandledRejection" | "uncaughtException",
  listeners: ProcessListener[],
): void {
  process.removeAllListeners(event_name);
  for (const listener of listeners) process.on(event_name, listener);
}
