import { afterEach, describe, expect, it, vi } from "vitest";

import { TranslationPipeline, TASK_PIPELINE_COMMIT_INTERVAL_MS } from "./translation-pipeline";

describe("TranslationPipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("密钥耗尽立即关闭供给，在途结果与用量仍提交且不再重试", async () => {
    let keys_exhausted = false;
    const releases: Array<() => void> = [];
    const executed: string[] = [];
    const committed: number[] = [];
    const signals: AbortSignal[] = [];
    const pipeline = new TranslationPipeline({
      read_dispatch_state: () => ({ concurrency_limit: 2, keys_exhausted }),
      signal: new AbortController().signal,
      execute: async (unit, signal) => {
        executed.push(unit.work_unit_id);
        signals.push(signal);
        await new Promise<void>((resolve) => releases.push(resolve));
        return {
          commit_entries: [commit(Number(unit.work_unit_id))],
          retry_contexts: [context(99)],
        };
      },
      commit: async (entries) => {
        committed.push(...entries.map((entry) => entry.input_tokens));
      },
    });
    const run = pipeline.run([context(1), context(2), context(3)]);
    keys_exhausted = true;
    releases.forEach((release) => release());
    await run;
    expect(executed).toEqual(["1", "2"]);
    expect(committed).toEqual([1, 2]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });

  it("升档补充活动任务，降档等待自然收束后再补发", async () => {
    vi.useFakeTimers();
    let limit = 4;
    let hold = true;
    const releases: Array<() => void> = [];
    const committed: number[] = [];
    const pipeline = new TranslationPipeline({
      read_dispatch_state: () => ({ concurrency_limit: limit, keys_exhausted: false }),
      signal: new AbortController().signal,
      execute: async (unit) => {
        if (hold) await new Promise<void>((resolve) => releases.push(resolve));
        return { commit_entries: [commit(Number(unit.work_unit_id))], retry_contexts: [] };
      },
      commit: async (entries) => {
        committed.push(...entries.map((entry) => entry.input_tokens));
      },
    });
    const run = pipeline.run(Array.from({ length: 10 }, (_, index) => context(index + 1)));
    expect(releases).toHaveLength(4);
    limit = 6;
    releases[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(7);
    limit = 2;
    for (const release of releases.slice(1, 5)) release();
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(7);
    releases[5]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(8);
    hold = false;
    for (const release of releases) release();
    await run;
    expect(committed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("队列收尾产生切分后仍填满额度，取消等待活动任务全部收束", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const executed: number[] = [];
    const pipeline = new TranslationPipeline({
      read_dispatch_state: () => ({ concurrency_limit: 4, keys_exhausted: false }),
      signal: controller.signal,
      execute: async (unit) => {
        const id = Number(unit.work_unit_id);
        executed.push(id);
        if (id === 1) return { commit_entries: [], retry_contexts: [2, 3, 4, 5, 6].map(context) };
        await new Promise<void>((resolve) => releases.push(resolve));
        return { commit_entries: [], retry_contexts: [] };
      },
      commit: async () => {},
    });
    let done = false;
    const run = pipeline.run([context(1)]).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(executed).toEqual([1, 2, 3, 4, 5]);
    controller.abort();
    releases[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    expect(executed).toEqual([1, 2, 3, 4, 5]);
    for (const release of releases.slice(1)) release();
    await run;
    expect(done).toBe(true);
  });

  it("优先执行重试队列并按批次提交结果", async () => {
    const executed: number[] = [];
    const committed: number[][] = [];
    const pipeline = new TranslationPipeline({
      read_dispatch_state: () => ({ concurrency_limit: 1, keys_exhausted: false }),
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
      read_dispatch_state: () => ({ concurrency_limit: 1, keys_exhausted: false }),
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
      read_dispatch_state: () => ({ concurrency_limit: 2, keys_exhausted: false }),
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
      read_dispatch_state: () => ({ concurrency_limit: 1, keys_exhausted: false }),
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

/** 仅推进有界微任务，等待流水线完成一次调度。 */
async function wait_until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  expect(predicate()).toBe(true);
}

/** 用请求身份构造最小上下文，测试只观察供给与重试顺序。 */
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
/** 通过提交载荷区分已完成任务，无需建立项目存储。 */
function commit(id: number) {
  return { items: [], input_tokens: id, reasoning_tokens: 0, output_tokens: 0 };
}
