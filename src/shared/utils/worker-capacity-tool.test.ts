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
  });

  it.each([
    [16, 4],
    [3, 2],
    [1, 1],
  ] as const)("并行度为 %i 时默认使用 %i 个 worker", (availableParallelism, expected) => {
    expect(
      resolve_default_worker_count({
        availableParallelism,
      }),
    ).toBe(expected);
  });
});
