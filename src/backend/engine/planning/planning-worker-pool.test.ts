import { describe, expect, it, vi } from "vitest";

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

  it("终止一个 worker 失败时仍等待其余 worker 并在清空 slots 后抛出聚合错误", async () => {
    const pool = new PlanningWorkerPool({ execution: { kind: "in_process" } });
    const slots = (
      pool as unknown as {
        slots: Array<{
          worker: { terminate: () => Promise<number> };
          task: null;
        }>;
      }
    ).slots;
    const termination_failure = new Error("planning worker terminate failed");
    let release_second_termination: () => void = () => undefined;
    const second_termination = new Promise<number>((resolve) => {
      release_second_termination = () => resolve(0);
    });
    const first_terminate = vi.fn(() => Promise.reject(termination_failure));
    const second_terminate = vi.fn(() => second_termination);
    slots.push(
      { worker: { terminate: first_terminate }, task: null },
      { worker: { terminate: second_terminate }, task: null },
    );
    let dispose_settled = false;
    const disposing = pool.dispose().then(
      () => {
        dispose_settled = true;
        return null;
      },
      (error: unknown) => {
        dispose_settled = true;
        return error;
      },
    );

    await Promise.resolve();
    expect(first_terminate).toHaveBeenCalledTimes(1);
    expect(second_terminate).toHaveBeenCalledTimes(1);
    expect(dispose_settled).toBe(false);

    release_second_termination();
    const error = await disposing;

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([termination_failure]);
    expect(slots).toHaveLength(0);
  });
});
