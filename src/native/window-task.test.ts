import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { run_window_task } from "./window-task";

afterEach(() => vi.useRealTimers());

it.each(["cancel", "timeout", "close", "crash"])(
  "%s 中断悬挂阶段并等待窗口关闭，迟到结果不执行下一阶段",
  async (cause) => {
    vi.useFakeTimers();
    const window = new EventEmitter();
    const contents = new EventEmitter();
    let destroyed = false;
    // 由测试确认原生关闭完成，区分请求销毁与实际回收。
    const destroy = vi.fn(() => {
      destroyed = true;
    });
    Object.assign(window, { webContents: contents, isDestroyed: () => destroyed, destroy });
    const controller = new AbortController();
    const pending = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const next = vi.fn(async () => undefined);
    const result = run_window_task(
      window as BrowserWindow,
      controller.signal,
      100,
      async (step) => {
        try {
          await step("script", () => pending.promise);
          await step("next", next);
        } finally {
          finished.resolve();
        }
      },
    );
    const rejected = expect(result).rejects.toThrow();
    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    if (cause === "cancel") controller.abort(new Error("cancelled"));
    else if (cause === "timeout") await vi.advanceTimersByTimeAsync(100);
    else if (cause === "close") {
      destroy();
      window.emit("closed");
    } else contents.emit("render-process-gone", {}, { reason: "crashed" });
    if (cause !== "close") {
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      window.emit("closed");
    }
    await rejected;
    expect(destroy).toHaveBeenCalledTimes(1);
    pending.resolve();
    await finished.promise;
    expect(next).not.toHaveBeenCalled();
    expect(contents.listenerCount("render-process-gone")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  },
);
