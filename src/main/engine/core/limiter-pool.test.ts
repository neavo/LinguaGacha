import { describe, expect, it, vi } from "vitest";

import { TaskLimiter } from "./limiter-pool";

describe("TaskLimiter", () => {
  it("未显式设置并发时固定使用默认并发 8", () => {
    expect(new TaskLimiter({ concurrency_limit: 0, rpm_limit: 1 }).max_concurrency).toBe(8);
    expect(new TaskLimiter({ concurrency_limit: 3 }).max_concurrency).toBe(3);
  });

  it("rpm_limit 小于等于 0 时只保留并发限制", async () => {
    const limiter = new TaskLimiter({ concurrency_limit: 2, rpm_limit: 0, now: () => 0 });
    const controller = new AbortController();
    const first = await limiter.acquire(controller.signal);
    const second = await limiter.acquire(controller.signal);
    expect(first.queued_ms).toBe(0);
    expect(second.queued_ms).toBe(0);
    first.release();
    second.release();
  });

  it("并发槽释放后才允许后续请求进入", async () => {
    const limiter = new TaskLimiter({ concurrency_limit: 1 });
    const controller = new AbortController();
    const first = await limiter.acquire(controller.signal);
    let second_acquired = false;
    const second = limiter.acquire(controller.signal).then((lease) => {
      second_acquired = true;
      lease.release();
    });

    await Promise.resolve();
    expect(second_acquired).toBe(false);

    first.release();
    await second;
    expect(second_acquired).toBe(true);
  });

  it("按 RPM 平滑发放请求资格", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 1, rpm_limit: 60, now: () => now });
      const controller = new AbortController();
      const first = await limiter.acquire(controller.signal);
      first.release();
      let second_acquired = false;
      const second = limiter.acquire(controller.signal).then((lease) => {
        second_acquired = true;
        return lease;
      });

      await Promise.resolve();
      expect(second_acquired).toBe(false);

      now = 999;
      await vi.advanceTimersByTimeAsync(999);
      expect(second_acquired).toBe(false);

      now = 1_000;
      await vi.advanceTimersByTimeAsync(1);
      const second_lease = await second;
      expect(second_lease.queued_ms).toBe(1_000);
      second_lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("多个等待请求按 FIFO 顺序获得 lease", async () => {
    const limiter = new TaskLimiter({ concurrency_limit: 1 });
    const controller = new AbortController();
    const first = await limiter.acquire(controller.signal);
    const acquired_order: number[] = [];
    const second = limiter.acquire(controller.signal).then((lease) => {
      acquired_order.push(2);
      return lease;
    });
    const third = limiter.acquire(controller.signal).then((lease) => {
      acquired_order.push(3);
      return lease;
    });

    await Promise.resolve();
    expect(acquired_order).toEqual([]);

    first.release();
    const second_lease = await second;
    expect(acquired_order).toEqual([2]);

    await Promise.resolve();
    expect(acquired_order).toEqual([2]);

    second_lease.release();
    const third_lease = await third;
    expect(acquired_order).toEqual([2, 3]);
    third_lease.release();
  });

  it("排队请求 abort 后会清理队列且不影响后续请求", async () => {
    const limiter = new TaskLimiter({ concurrency_limit: 1 });
    const first_controller = new AbortController();
    const queued_controller = new AbortController();
    const later_controller = new AbortController();
    const first = await limiter.acquire(first_controller.signal);
    const queued = limiter.acquire(queued_controller.signal);

    queued_controller.abort();
    await expect(queued).rejects.toThrow("任务已停止。");

    first.release();
    const later = await limiter.acquire(later_controller.signal);
    later.release();
  });

  it("lease 重复 release 不会多发放并发槽", async () => {
    const limiter = new TaskLimiter({ concurrency_limit: 1 });
    const controller = new AbortController();
    const first = await limiter.acquire(controller.signal);
    const acquired_order: number[] = [];
    const second = limiter.acquire(controller.signal).then((lease) => {
      acquired_order.push(2);
      return lease;
    });
    const third = limiter.acquire(controller.signal).then((lease) => {
      acquired_order.push(3);
      return lease;
    });

    first.release();
    first.release();
    const second_lease = await second;
    expect(acquired_order).toEqual([2]);

    await Promise.resolve();
    expect(acquired_order).toEqual([2]);

    second_lease.release();
    const third_lease = await third;
    expect(acquired_order).toEqual([2, 3]);
    third_lease.release();
  });
});
