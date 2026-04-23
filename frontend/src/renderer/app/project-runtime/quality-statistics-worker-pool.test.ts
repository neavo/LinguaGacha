import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
} from "@/app/project-runtime/quality-statistics";
import {
  QUALITY_STATISTICS_STALE_ERROR_MESSAGE,
  createQualityStatisticsWorkerPool,
} from "@/app/project-runtime/quality-statistics-worker-pool";

type WorkerRequestMessage = {
  id: number;
  input: QualityStatisticsTaskInput;
};

class MockWorker {
  static instances: MockWorker[] = [];

  posted_messages: WorkerRequestMessage[] = [];
  terminated = false;
  private message_listener:
    | ((event: MessageEvent<{ id: number; output: QualityStatisticsTaskResult }>) => void)
    | null = null;
  private error_listener: ((event: Event) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      this.message_listener = listener as (
        event: MessageEvent<{ id: number; output: QualityStatisticsTaskResult }>,
      ) => void;
      return;
    }

    if (type === "error") {
      this.error_listener = listener as (event: Event) => void;
    }
  }

  postMessage(message: WorkerRequestMessage): void {
    this.posted_messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  dispatch_message(data: { id: number; output: QualityStatisticsTaskResult }): void {
    this.message_listener?.({ data } as MessageEvent<{
      id: number;
      output: QualityStatisticsTaskResult;
    }>);
  }

  dispatch_error(): void {
    this.error_listener?.(new Event("error"));
  }
}

function create_input(key: string): QualityStatisticsTaskInput {
  return {
    rules: [
      {
        key,
        pattern: key,
        mode: "glossary",
        case_sensitive: true,
      },
    ],
    srcTexts: [key],
    dstTexts: [],
    relationCandidates: [],
  };
}

function create_output(key: string, matched_item_count: number): QualityStatisticsTaskResult {
  return {
    results: {
      [key]: {
        matched_item_count,
        subset_parents: [],
      },
    },
  };
}

describe("createQualityStatisticsWorkerPool", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常返回 worker 统计结果", async () => {
    const pool = createQualityStatisticsWorkerPool({
      worker_count: 1,
    });
    const result_promise = pool.submit(create_input("alpha"));
    const worker = MockWorker.instances[0];

    expect(worker?.posted_messages).toHaveLength(1);

    worker?.dispatch_message({
      id: 1,
      output: create_output("alpha", 2),
    });

    await expect(result_promise).resolves.toEqual(create_output("alpha", 2));
    pool.dispose();
  });

  it("同 stale_key 的旧请求结果会被丢弃", async () => {
    const pool = createQualityStatisticsWorkerPool({
      worker_count: 1,
    });
    const first_result = pool.submit(create_input("first"), {
      stale_key: "glossary",
    });
    const second_result = pool.submit(create_input("second"), {
      stale_key: "glossary",
    });
    const worker = MockWorker.instances[0];

    expect(worker?.posted_messages).toHaveLength(1);

    worker?.dispatch_message({
      id: 1,
      output: create_output("first", 1),
    });

    await expect(first_result).rejects.toThrow(QUALITY_STATISTICS_STALE_ERROR_MESSAGE);
    expect(worker?.posted_messages).toHaveLength(2);

    worker?.dispatch_message({
      id: 2,
      output: create_output("second", 3),
    });

    await expect(second_result).resolves.toEqual(create_output("second", 3));
    pool.dispose();
  });

  it("worker 出错后会回收并允许后续任务继续执行", async () => {
    const pool = createQualityStatisticsWorkerPool({
      worker_count: 1,
    });
    const first_result = pool.submit(create_input("broken"));
    const first_worker = MockWorker.instances[0];

    first_worker?.dispatch_error();

    await expect(first_result).rejects.toThrow("quality statistics worker 执行失败。");
    expect(first_worker?.terminated).toBe(true);

    const second_result = pool.submit(create_input("next"));
    const replacement_worker = MockWorker.instances[1];
    expect(replacement_worker).not.toBeUndefined();

    replacement_worker?.dispatch_message({
      id: 2,
      output: create_output("next", 4),
    });

    await expect(second_result).resolves.toEqual(create_output("next", 4));
    pool.dispose();
  });
});
