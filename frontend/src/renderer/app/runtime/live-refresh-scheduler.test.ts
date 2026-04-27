import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveRefreshScheduler } from "@/app/runtime/live-refresh-scheduler";

describe("LiveRefreshScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同一窗口内的多条入站事件只刷新一次", () => {
    vi.useFakeTimers();
    const on_flush = vi.fn();
    const scheduler = new LiveRefreshScheduler({
      intervalMs: 250,
      onFlush: on_flush,
    });

    scheduler.enqueue("project.patch", { id: 1 });
    scheduler.enqueue("project.patch", { id: 2 });
    scheduler.enqueue("task.progress", { line: 3 });

    vi.advanceTimersByTime(249);
    expect(on_flush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(on_flush).toHaveBeenCalledTimes(1);
    const batches = on_flush.mock.calls[0]?.[0] as ReadonlyMap<string, readonly unknown[]>;
    expect(batches.get("project.patch")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(batches.get("task.progress")).toEqual([{ line: 3 }]);
  });

  it("dispose 后会丢弃待刷新事件并拒绝后续入队", () => {
    vi.useFakeTimers();
    const on_flush = vi.fn();
    const scheduler = new LiveRefreshScheduler({
      intervalMs: 250,
      onFlush: on_flush,
    });

    scheduler.enqueue("logs", { id: 1 });
    scheduler.dispose();
    scheduler.enqueue("logs", { id: 2 });
    vi.advanceTimersByTime(250);

    expect(on_flush).not.toHaveBeenCalled();
  });
});
