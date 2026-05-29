import { describe, expect, it } from "vitest";

import { resolve_default_worker_count } from "./worker-capacity-tool";

describe("resolve_default_worker_count", () => {
  it("显式 workerCount 只做整数收口并至少保留一个 worker", () => {
    expect(
      resolve_default_worker_count({
        workerCount: 2.9,
        availableParallelism: 16,
      }),
    ).toBe(2);
    expect(
      resolve_default_worker_count({
        workerCount: 0,
        availableParallelism: 16,
      }),
    ).toBe(1);
    expect(
      resolve_default_worker_count({
        workerCount: -3,
        availableParallelism: 16,
      }),
    ).toBe(1);
  });

  it("默认容量共用同一条 CPU 策略并最多使用四个 worker", () => {
    expect(
      resolve_default_worker_count({
        availableParallelism: 16,
      }),
    ).toBe(4);
  });

  it("低并行度环境会保留主线程槽位但仍至少返回一个 worker", () => {
    expect(
      resolve_default_worker_count({
        availableParallelism: 1,
      }),
    ).toBe(1);
  });
});
