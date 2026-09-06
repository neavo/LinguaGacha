import { afterEach, describe, expect, it, vi } from "vitest";

import { TranslationPipeline, TASK_PIPELINE_COMMIT_INTERVAL_MS } from "./translation-pipeline";

describe("TranslationPipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("优先执行重试队列并按批次提交结果", async () => {
    const executed: number[] = [];
    const committed: number[][] = [];
    const pipeline = new TranslationPipeline({
      worker_count: 1,
      signal: new AbortController().signal,
      execute: async (unit) => {
        executed.push(Number(unit.work_unit_id));
        if (Number(unit.work_unit_id) === 1) {
          return { commit_entries: [commit(10)], retry_contexts: [context(100)] };
        }
        return { commit_entries: [commit(Number(unit.work_unit_id))], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push(entries.map((entry) => entry.input_tokens));
      },
    });

    await pipeline.run([context(1), context(2)]);

    expect(executed).toEqual([1, 100, 2]);
    expect(committed.flat()).toEqual([10, 100, 2]);
  });

  it("把定时提交里的错误回传给调用方", async () => {
    vi.useFakeTimers();
    let release_second_context: () => void = () => {};
    let second_context_started = false;
    const pipeline = new TranslationPipeline({
      worker_count: 1,
      signal: new AbortController().signal,
      execute: async (unit) => {
        if (Number(unit.work_unit_id) === 2) {
          second_context_started = true;
          await new Promise<void>((resolve) => {
            release_second_context = resolve;
          });
        }
        return { commit_entries: [commit(Number(unit.work_unit_id))], retry_contexts: [] };
      },
      commit: async (entries) => {
        if (entries.some((entry) => entry.input_tokens === 1)) {
          throw new Error("提交失败");
        }
      },
    });

    const run_promise = pipeline.run([context(1), context(2)]);
    await wait_until(() => second_context_started);
    await vi.advanceTimersByTimeAsync(TASK_PIPELINE_COMMIT_INTERVAL_MS);

    release_second_context();

    await expect(run_promise).rejects.toThrow("提交失败");
  });

  it("worker 失败时关停队列并等待已运行 worker 收束", async () => {
    const executed: number[] = [];
    const committed: number[][] = [];
    let release_second_worker: () => void = () => {};
    let second_worker_saw_abort = false;
    let settled = false;
    const pipeline = new TranslationPipeline({
      worker_count: 2,
      signal: new AbortController().signal,
      execute: async (unit, signal) => {
        executed.push(Number(unit.work_unit_id));
        if (Number(unit.work_unit_id) === 1) {
          throw new Error("worker 失败");
        }
        if (Number(unit.work_unit_id) === 2) {
          await new Promise<void>((resolve) => {
            release_second_worker = resolve;
          });
          second_worker_saw_abort = signal.aborted;
        }
        return { commit_entries: [commit(Number(unit.work_unit_id))], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push(entries.map((entry) => entry.input_tokens));
      },
    });

    const result_promise = pipeline.run([context(1), context(2), context(3)]).then(
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
    const pipeline = new TranslationPipeline({
      worker_count: 1,
      signal: new AbortController().signal,
      execute: async (unit) => {
        if (Number(unit.work_unit_id) === 2) {
          await new Promise<void>((resolve) => {
            release_second_context = resolve;
          });
        }
        return { commit_entries: [commit(Number(unit.work_unit_id))], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push(entries.map((entry) => entry.input_tokens));
      },
    });

    const run_promise = pipeline.run([context(1), context(2)]);
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

async function wait_until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  expect(predicate()).toBe(true);
}

function context(id: number) {
  return {
    work_unit_id: String(id),
    items: [],
    precedings: [],
    token_threshold: 10,
    split_count: 0,
    retry_count: 0,
    is_initial: true,
  };
}
function commit(id: number) {
  return { items: [], input_tokens: id, reasoning_tokens: 0, output_tokens: 0 };
}
