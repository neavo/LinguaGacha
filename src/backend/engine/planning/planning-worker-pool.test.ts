import { describe, expect, it } from "vitest";

import { PlanningWorkerPool } from "./planning-worker-pool";

describe("PlanningWorkerPool", () => {
  it("in_process 模式按输入顺序返回 token 计数结果", async () => {
    const pool = new PlanningWorkerPool({ execution: { kind: "in_process" }, workerCount: 1 });

    const results = await pool.count_items(
      [
        { cache_key: "a", text: "hello" },
        { cache_key: "b", text: "世界" },
      ],
      new AbortController().signal,
    );

    expect(results.map((result) => result.cache_key)).toEqual(["a", "b"]);
    expect(results.every((result) => result.token_count > 0)).toBe(true);
    await pool.dispose();
  });

  it("收到已取消 signal 时拒绝规划请求", async () => {
    const pool = new PlanningWorkerPool({ execution: { kind: "in_process" }, workerCount: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      pool.count_items([{ cache_key: "a", text: "hello" }], controller.signal),
    ).rejects.toMatchObject({
      code: "runtime.cancelled",
    });
    await pool.dispose();
  });
});
