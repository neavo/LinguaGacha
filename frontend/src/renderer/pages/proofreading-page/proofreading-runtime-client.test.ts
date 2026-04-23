import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProofreadingRuntimeClient } from "./proofreading-runtime-client";
import { computeProofreadingSnapshot, type ProofreadingRuntimeInput } from "./proofreading-runtime";

type WorkerRequestMessage = {
  id: number;
  input: ProofreadingRuntimeInput;
};

class MockWorker {
  static instances: MockWorker[] = [];

  posted_messages: WorkerRequestMessage[] = [];
  terminated = false;
  private error_listener: ((event: Event) => void) | null = null;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      void listener;
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

  dispatch_error(): void {
    this.error_listener?.(new Event("error"));
  }
}

function create_input(): ProofreadingRuntimeInput {
  return {
    project_id: "demo",
    revision: 1,
    total_item_count: 0,
    items: [],
    quality: {} as ProofreadingRuntimeInput["quality"],
    settings: {
      source_language: "JA",
    },
  };
}

vi.mock("./proofreading-runtime", () => {
  return {
    computeProofreadingSnapshot: vi.fn(),
  };
});

describe("createProofreadingRuntimeClient", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("当前环境不支持 Worker 时直接抛出结构化错误", async () => {
    vi.stubGlobal("Worker", undefined);

    const client = createProofreadingRuntimeClient();

    await expect(client.compute(create_input())).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "unsupported",
    });
    expect(computeProofreadingSnapshot).not.toHaveBeenCalled();
  });

  it("Worker 初始化失败时直接抛出结构化错误", async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error("boom");
      }
    }

    vi.stubGlobal("Worker", ThrowingWorker as unknown as typeof Worker);

    const client = createProofreadingRuntimeClient();

    await expect(client.compute(create_input())).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "init_failed",
    });
    expect(computeProofreadingSnapshot).not.toHaveBeenCalled();
  });

  it("worker 执行报错时 reject 且不再回退主线程计算", async () => {
    const client = createProofreadingRuntimeClient();
    const result_promise = client.compute(create_input());
    const worker = MockWorker.instances[0];

    worker?.dispatch_error();

    await expect(result_promise).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "execution_failed",
    });
    expect(worker?.terminated).toBe(true);
    expect(computeProofreadingSnapshot).not.toHaveBeenCalled();
    client.dispose();
  });
});
