import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";

import { run_abortable_window_operation } from "./desktop-window-operation";

function create_window(): BrowserWindow {
  let destroyed = false;
  return {
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    isDestroyed: vi.fn(() => destroyed),
  } as unknown as BrowserWindow;
}

describe("run_abortable_window_operation", () => {
  it("操作成功后返回结果并销毁窗口", async () => {
    const target_window = create_window();

    await expect(
      run_abortable_window_operation(
        target_window,
        new AbortController().signal,
        async () => "done",
      ),
    ).resolves.toBe("done");
    expect(target_window.destroy).toHaveBeenCalledOnce();
  });

  it("操作失败后保留错误并销毁窗口", async () => {
    const target_window = create_window();
    const error = new Error("failed");

    await expect(
      run_abortable_window_operation(target_window, new AbortController().signal, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(target_window.destroy).toHaveBeenCalledOnce();
  });

  it("取消后以原始原因结束等待并销毁窗口", async () => {
    const target_window = create_window();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const running = run_abortable_window_operation(
      target_window,
      controller.signal,
      async () => await new Promise<never>(() => undefined),
    );

    controller.abort(reason);

    await expect(running).rejects.toBe(reason);
    expect(target_window.destroy).toHaveBeenCalledOnce();
  });

  it("已取消时不启动窗口操作", async () => {
    const target_window = create_window();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const operation = vi.fn(async () => "done");
    controller.abort(reason);

    await expect(
      run_abortable_window_operation(target_window, controller.signal, operation),
    ).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();
    expect(target_window.destroy).toHaveBeenCalledOnce();
  });
});
