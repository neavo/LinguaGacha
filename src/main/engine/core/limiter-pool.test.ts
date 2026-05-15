import { describe, expect, it, vi } from "vitest";

import { TaskLimiter, resolve_effective_concurrency_limit } from "./limiter-pool";

describe("TaskLimiter", () => {
  it("按显式并发、RPM、一致默认值推导最终并发", () => {
    expect(resolve_effective_concurrency_limit({ concurrency_limit: 16, rpm_limit: 1000 })).toBe(
      16,
    );
    expect(resolve_effective_concurrency_limit({ concurrency_limit: 0, rpm_limit: 1 })).toBe(1);
    expect(resolve_effective_concurrency_limit({ concurrency_limit: 0, rpm_limit: 60 })).toBe(60);
    expect(resolve_effective_concurrency_limit({ concurrency_limit: 0, rpm_limit: 1000 })).toBe(
      1000,
    );
    expect(resolve_effective_concurrency_limit({ concurrency_limit: 0, rpm_limit: 0 })).toBe(8);
  });

  it("TaskLimiter 只接收最终并发值", () => {
    expect(new TaskLimiter({ max_concurrency: 1, rpm_limit: 60 }).max_concurrency).toBe(1);
    expect(new TaskLimiter({ max_concurrency: 3 }).max_concurrency).toBe(3);
  });

  it("无 RPM 时先填满并发，后续请求按隐藏 RPS 补充启动资格", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 2, rpm_limit: 0, now: () => now });
      const controller = new AbortController();
      const first = await limiter.acquire(controller.signal);
      const second = await limiter.acquire(controller.signal);
      let third_acquired = false;
      const third = limiter.acquire(controller.signal).then((lease) => {
        third_acquired = true;
        return lease;
      });

      first.release();
      second.release();
      await Promise.resolve();
      expect(third_acquired).toBe(false);

      now = 499;
      await vi.advanceTimersByTimeAsync(499);
      expect(third_acquired).toBe(false);

      now = 500;
      await vi.advanceTimersByTimeAsync(1);
      const third_lease = await third;
      expect(third_lease.queued_ms).toBe(500);
      third_lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("并发槽释放后才允许后续请求进入", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 1, now: () => now });
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
      now = 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      await second;
      expect(second_acquired).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("有 RPM 时只按 RPM 平滑发放请求资格", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 2, rpm_limit: 60, now: () => now });
      const controller = new AbortController();
      const first = await limiter.acquire(controller.signal);
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
      first.release();
      second_lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("多个等待请求按 FIFO 顺序获得 lease", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 1, now: () => now });
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
      now = 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      const second_lease = await second;
      expect(acquired_order).toEqual([2]);

      await Promise.resolve();
      expect(acquired_order).toEqual([2]);

      second_lease.release();
      now = 2_000;
      await vi.advanceTimersByTimeAsync(1_000);
      const third_lease = await third;
      expect(acquired_order).toEqual([2, 3]);
      third_lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("排队请求 abort 后会清理队列且不影响后续请求", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 1, now: () => now });
      const first_controller = new AbortController();
      const queued_controller = new AbortController();
      const later_controller = new AbortController();
      const first = await limiter.acquire(first_controller.signal);
      const queued = limiter.acquire(queued_controller.signal);

      queued_controller.abort();
      await expect(queued).rejects.toThrow("任务已停止。");

      first.release();
      const later_promise = limiter.acquire(later_controller.signal);
      now = 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      const later = await later_promise;
      later.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lease 重复 release 不会多发放并发槽", async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const limiter = new TaskLimiter({ concurrency_limit: 1, now: () => now });
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
      now = 1_000;
      await vi.advanceTimersByTimeAsync(1_000);
      const second_lease = await second;
      expect(acquired_order).toEqual([2]);

      await Promise.resolve();
      expect(acquired_order).toEqual([2]);

      second_lease.release();
      now = 2_000;
      await vi.advanceTimersByTimeAsync(1_000);
      const third_lease = await third;
      expect(acquired_order).toEqual([2, 3]);
      third_lease.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
