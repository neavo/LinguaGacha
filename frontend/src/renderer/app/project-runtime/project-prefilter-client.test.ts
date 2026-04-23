import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectPrefilterClient } from "./project-prefilter-client";
import { compute_project_prefilter_mutation } from "./project-prefilter";
import type { ProjectPrefilterMutationInput } from "./project-prefilter";

type WorkerRequestMessage = {
  id: number;
  input: ProjectPrefilterMutationInput;
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

function create_input(): ProjectPrefilterMutationInput {
  return {
    state: {} as ProjectPrefilterMutationInput["state"],
    source_language: "JA",
    mtool_optimizer_enable: false,
  };
}

vi.mock("./project-prefilter", () => {
  return {
    compute_project_prefilter_mutation: vi.fn(),
  };
});

describe("createProjectPrefilterClient", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("当前环境不支持 Worker 时直接抛出结构化错误", async () => {
    vi.stubGlobal("Worker", undefined);

    const client = createProjectPrefilterClient();

    await expect(client.compute(create_input())).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "unsupported",
    });
    expect(compute_project_prefilter_mutation).not.toHaveBeenCalled();
  });

  it("Worker 初始化失败时直接抛出结构化错误", async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error("boom");
      }
    }

    vi.stubGlobal("Worker", ThrowingWorker as unknown as typeof Worker);

    const client = createProjectPrefilterClient();

    await expect(client.compute(create_input())).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "init_failed",
    });
    expect(compute_project_prefilter_mutation).not.toHaveBeenCalled();
  });

  it("worker 执行报错时 reject 且不再回退主线程计算", async () => {
    const client = createProjectPrefilterClient();
    const result_promise = client.compute(create_input());
    const worker = MockWorker.instances[0];

    worker?.dispatch_error();

    await expect(result_promise).rejects.toMatchObject({
      name: "WorkerClientError",
      code: "execution_failed",
    });
    expect(worker?.terminated).toBe(true);
    expect(compute_project_prefilter_mutation).not.toHaveBeenCalled();
    client.dispose();
  });
});
