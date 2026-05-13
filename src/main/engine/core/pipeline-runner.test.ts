import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskPipeline, TASK_PIPELINE_COMMIT_INTERVAL_MS } from "./pipeline-runner";

describe("TaskPipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("优先执行重试队列并按批次提交结果", async () => {
    const executed: number[] = [];
    const committed: number[][] = [];
    const pipeline = new TaskPipeline<number, number>({
      worker_count: 1,
      signal: new AbortController().signal,
      commit_interval_ms: 1,
      execute: async (context) => {
        executed.push(context);
        if (context === 1) {
          return { commit_entries: [10], retry_contexts: [100] };
        }
        return { commit_entries: [context], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push([...entries]);
      },
    });

    await pipeline.run([1, 2]);

    expect(executed).toEqual([1, 100, 2]);
    expect(committed.flat()).toEqual([10, 100, 2]);
  });

  it("把定时提交里的错误回传给调用方", async () => {
    const pipeline = new TaskPipeline<number, number>({
      worker_count: 1,
      signal: new AbortController().signal,
      commit_interval_ms: 1,
      execute: async (context) => {
        if (context === 2) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 5);
          });
        }
        return { commit_entries: [context], retry_contexts: [] };
      },
      commit: async (entries) => {
        if (entries.includes(1)) {
          throw new Error("提交失败");
        }
      },
    });

    await expect(pipeline.run([1, 2])).rejects.toThrow("提交失败");
  });

  it("worker 失败时关停队列并等待已运行 worker 收束", async () => {
    const executed: number[] = [];
    const committed: number[][] = [];
    let release_second_worker: () => void = () => {};
    let second_worker_saw_abort = false;
    let settled = false;
    const pipeline = new TaskPipeline<number, number>({
      worker_count: 2,
      signal: new AbortController().signal,
      commit_interval_ms: 1,
      execute: async (context, signal) => {
        executed.push(context);
        if (context === 1) {
          throw new Error("worker 失败");
        }
        if (context === 2) {
          await new Promise<void>((resolve) => {
            release_second_worker = resolve;
          });
          second_worker_saw_abort = signal.aborted;
        }
        return { commit_entries: [context], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push([...entries]);
      },
    });

    const result_promise = pipeline.run([1, 2, 3]).then(
      () => {
        settled = true;
        return { ok: true as const };
      },
      (error: unknown) => {
        settled = true;
        return { ok: false as const, error };
      },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(executed).toEqual([1, 2]);

    release_second_worker();
    const result = await result_promise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe("worker 失败");
    }
    expect(second_worker_saw_abort).toBe(true);
    expect(executed).toEqual([1, 2]);
    expect(committed).toEqual([]);
  });

  it("默认按 500ms 窗口批量提交 worker 结果", async () => {
    vi.useFakeTimers();
    const committed: number[][] = [];
    let release_second_context: () => void = () => {};
    const pipeline = new TaskPipeline<number, number>({
      worker_count: 1,
      signal: new AbortController().signal,
      execute: async (context) => {
        if (context === 2) {
          await new Promise<void>((resolve) => {
            release_second_context = resolve;
          });
        }
        return { commit_entries: [context], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push([...entries]);
      },
    });

    const run_promise = pipeline.run([1, 2]);
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(TASK_PIPELINE_COMMIT_INTERVAL_MS - 1);
    expect(committed).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(committed).toEqual([[1]]);

    release_second_context();
    await run_promise;

    expect(committed).toEqual([[1], [2]]);
  });
});
