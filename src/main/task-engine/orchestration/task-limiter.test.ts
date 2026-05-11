import { describe, expect, it, vi } from "vitest";

import { TaskLimiter } from "./task-limiter";

describe("TaskLimiter", () => {
  it("未显式设置并发时固定使用默认并发 8", () => {
    expect(new TaskLimiter({ concurrency_limit: 0, rpm_limit: 1 }).max_concurrency).toBe(8);
    expect(new TaskLimiter({ concurrency_limit: 3 }).max_concurrency).toBe(3);
  });

  it("并发槽释放后才允许后续请求进入", async () => {
    const limiter = new TaskLimiter({ concurrency_limit: 1 });
    const controller = new AbortController();
    const first_release = await limiter.acquire(controller.signal);
    let second_acquired = false;
    const second = limiter.acquire(controller.signal).then((release) => {
      second_acquired = true;
      release();
    });

    await Promise.resolve();
    expect(second_acquired).toBe(false);

    first_release();
    await second;
    expect(second_acquired).toBe(true);
  });

  it("RPM 窗口未释放时等待下一分钟", async () => {
    vi.useFakeTimers();
    let now = 0;
    const limiter = new TaskLimiter({ concurrency_limit: 1, rpm_limit: 1, now: () => now });
    const controller = new AbortController();
    const first_release = await limiter.acquire(controller.signal);
    first_release();
    let acquired = false;
    const second = limiter.acquire(controller.signal).then((release) => {
      acquired = true;
      release();
    });

    await vi.advanceTimersByTimeAsync(59_999);
    now = 59_999;
    expect(acquired).toBe(false);

    now = 60_000;
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(acquired).toBe(true);
    vi.useRealTimers();
  });
});
