import { describe, expect, it, vi } from "vitest";

import { LogAppendBuffer } from "./log-append-buffer";

describe("LogAppendBuffer", () => {
  it("在同一时间窗内批量刷出日志", () => {
    vi.useFakeTimers();
    const batches: number[][] = [];
    const buffer = new LogAppendBuffer<number>({
      intervalMs: 50,
      onFlush: (events) => batches.push(events),
    });

    buffer.append(1);
    buffer.append(2);
    vi.advanceTimersByTime(49);
    expect(batches).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(batches).toEqual([[1, 2]]);
  });

  it("销毁时立即刷出末批日志且不重复回调", () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    const buffer = new LogAppendBuffer<string>({
      intervalMs: 50,
      onFlush: (events) => batches.push(events),
    });

    buffer.append("pending");
    buffer.dispose();
    vi.runAllTimers();

    expect(batches).toEqual([["pending"]]);
  });
});
