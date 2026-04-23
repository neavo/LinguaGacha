import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createQualityStatisticsClient,
  type QualityStatisticsTaskInput,
  type QualityStatisticsTaskResult,
} from "./quality-statistics-client";

type WorkerRequestMessage = {
  id: number;
  input: QualityStatisticsTaskInput;
};

class MockWorker {
  static instances: MockWorker[] = [];

  posted_messages: WorkerRequestMessage[] = [];
  terminated = false;
  private message_listener: ((event: MessageEvent<QualityStatisticsTaskResult>) => void) | null =
    null;
  private error_listener: ((event: Event) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      this.message_listener = listener as (
        event: MessageEvent<QualityStatisticsTaskResult>,
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
    this.message_listener?.({ data } as unknown as MessageEvent<QualityStatisticsTaskResult>);
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

describe("createQualityStatisticsClient", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常返回 worker 统计结果", async () => {
    const client = createQualityStatisticsClient();
    const result_promise = client.compute(create_input("alpha"));
    const worker = MockWorker.instances[0];

    expect(worker?.posted_messages).toHaveLength(1);

    worker?.dispatch_message({
      id: 1,
      output: create_output("alpha", 2),
    });

    await expect(result_promise).resolves.toEqual(create_output("alpha", 2));
    client.dispose();
  });

  it("新请求会覆盖旧请求并丢弃过期响应", async () => {
    const client = createQualityStatisticsClient();
    const first_result = client.compute(create_input("first"));
    const worker = MockWorker.instances[0];
    const second_result = client.compute(create_input("second"));

    await expect(first_result).rejects.toThrow("quality statistics 请求已被更新请求覆盖。");

    worker?.dispatch_message({
      id: 1,
      output: create_output("first", 1),
    });
    worker?.dispatch_message({
      id: 2,
      output: create_output("second", 3),
    });

    await expect(second_result).resolves.toEqual(create_output("second", 3));
    client.dispose();
  });

  it("worker 报错时向上抛出异常", async () => {
    const client = createQualityStatisticsClient();
    const result_promise = client.compute(create_input("broken"));
    const worker = MockWorker.instances[0];

    worker?.dispatch_error();

    await expect(result_promise).rejects.toThrow("quality statistics worker 执行失败。");
    expect(worker?.terminated).toBe(true);
    client.dispose();
  });
});
