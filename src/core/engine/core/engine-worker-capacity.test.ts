import os from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolve_engine_worker_count } from "./engine-worker-capacity";

describe("resolve_engine_worker_count", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("显式 workerCount 只做整数收口并至少保留一个 worker", () => {
    expect(resolve_engine_worker_count(2.9)).toBe(2);
    expect(resolve_engine_worker_count(0)).toBe(1);
    expect(resolve_engine_worker_count(-3)).toBe(1);
  });

  it("默认容量共用同一条 CPU 策略并最多使用四个 worker", () => {
    vi.spyOn(os, "availableParallelism").mockReturnValue(16);

    expect(resolve_engine_worker_count(undefined)).toBe(4);
  });

  it("低并行度环境会保留主进程槽位但仍至少返回一个 worker", () => {
    vi.spyOn(os, "availableParallelism").mockReturnValue(1);

    expect(resolve_engine_worker_count(undefined)).toBe(1);
  });
});
