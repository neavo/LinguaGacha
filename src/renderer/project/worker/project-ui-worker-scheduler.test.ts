import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectUiWorkerScheduler } from "@/project/worker/project-ui-worker-scheduler";
import type {
  ProjectUiWorkerRequest,
  ProjectUiWorkerResponse,
} from "@/project/worker/project-ui-worker-protocol";

type WorkerRequestMessage = ProjectUiWorkerRequest;

// MockWorker 模拟外部运行时对象，只保留当前测试会触发的行为面。
class MockWorker {
  static instances: MockWorker[] = [];

  posted_messages: WorkerRequestMessage[] = [];
  terminated = false;
  private message_listener: ((event: MessageEvent<ProjectUiWorkerResponse>) => void) | null = null;
  private error_listener: ((event: Event) => void) | null = null;

  // 构造阶段只注入必要依赖，避免实例创建时读取外部可变状态。
  public constructor(_url: URL | string, _options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  // addEventListener 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
  public addEventListener(type: string, listener: EventListener): void {
    if (type === "message") {
      this.message_listener = listener as (event: MessageEvent<ProjectUiWorkerResponse>) => void;
      return;
    }

    if (type === "error") {
      this.error_listener = listener as (event: Event) => void;
    }
  }

  // postMessage 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
  public postMessage(message: WorkerRequestMessage): void {
    this.posted_messages.push(message);
  }

  // terminate 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
  public terminate(): void {
    this.terminated = true;
  }

  // dispatch_message 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
  public dispatch_message(id: number, result: unknown = null): void {
    this.message_listener?.({
      data: {
        id,
        ok: true,
        result,
      },
    } as MessageEvent<ProjectUiWorkerResponse>);
  }

  // dispatch_failure 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
  public dispatch_failure(id: number): void {
    this.message_listener?.({
      data: {
        id,
        ok: false,
        error_diagnostic: {
          name: "Error",
          message: "worker 爆炸",
          stack: "Error: worker 爆炸\n    at run",
          context: {
            worker_message_type: "quality.compute_statistics",
          },
        },
      },
    } as unknown as MessageEvent<ProjectUiWorkerResponse>);
  }

  // dispatch_error 模拟测试场景中的对应运行时方法，保持断言聚焦协议行为。
  public dispatch_error(): void {
    this.error_listener?.(new Event("error"));
  }
}

// create_quality_request 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_quality_request(pattern: string): ProjectUiWorkerRequest {
  return {
    id: 0,
    type: "quality.compute_statistics",
    input: {
      rules: [
        {
          key: pattern,
          pattern,
          mode: "glossary",
        },
      ],
      srcTexts: [pattern],
      dstTexts: [],
      relationCandidates: [],
    },
  };
}

// create_scheduler 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function create_scheduler(): ProjectUiWorkerScheduler {
  return new ProjectUiWorkerScheduler(
    () => new MockWorker("project-ui-worker-entry.js") as unknown as Worker,
  );
}

// read_quality_rule_keys 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function read_quality_rule_keys(worker: MockWorker | undefined): string[] {
  return (
    worker?.posted_messages.flatMap((message) => {
      return message.type === "quality.compute_statistics"
        ? [message.input.rules[0]?.key ?? ""]
        : [];
    }) ?? []
  );
}

describe("ProjectUiWorkerScheduler", () => {
  beforeEach(() => {
    MockWorker.instances = [];
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按单 worker 通道串行派发并优先处理前台请求", async () => {
    const scheduler = create_scheduler();
    const first_result = scheduler.submit(create_quality_request("first"), {
      priority: "background",
    });
    const second_result = scheduler.submit(create_quality_request("second"), {
      priority: "background",
    });
    const foreground_result = scheduler.submit(create_quality_request("foreground"), {
      priority: "foreground",
    });
    const worker = MockWorker.instances[0];

    expect(read_quality_rule_keys(worker)).toEqual(["first"]);

    worker?.dispatch_message(1, "first-result");
    await expect(first_result).resolves.toBe("first-result");
    expect(read_quality_rule_keys(worker)).toEqual(["first", "foreground"]);

    worker?.dispatch_message(3, "foreground-result");
    await expect(foreground_result).resolves.toBe("foreground-result");
    expect(read_quality_rule_keys(worker)).toEqual(["first", "foreground", "second"]);

    worker?.dispatch_message(2, "second-result");
    await expect(second_result).resolves.toBe("second-result");
    scheduler.dispose();
  });

  it("同 staleKey 的排队旧请求不会派发给 worker", async () => {
    const scheduler = create_scheduler();
    const blocker_result = scheduler.submit(create_quality_request("blocker"), {
      priority: "background",
    });
    const stale_result = scheduler.submit(create_quality_request("stale"), {
      priority: "background",
      staleKey: "quality",
    });
    const fresh_result = scheduler.submit(create_quality_request("fresh"), {
      priority: "background",
      staleKey: "quality",
    });
    const worker = MockWorker.instances[0];

    worker?.dispatch_message(1, "blocker-result");
    await expect(blocker_result).resolves.toBe("blocker-result");
    await expect(stale_result).rejects.toMatchObject({
      name: "ProjectUiWorkerClientError",
      code: "stale",
    });
    expect(read_quality_rule_keys(worker)).toEqual(["blocker", "fresh"]);

    worker?.dispatch_message(3, "fresh-result");
    await expect(fresh_result).resolves.toBe("fresh-result");
    scheduler.dispose();
  });

  it("worker 通道失败后拒绝当前任务并用新 worker 继续处理队列", async () => {
    const scheduler = create_scheduler();
    const broken_result = scheduler.submit(create_quality_request("broken"));
    const next_result = scheduler.submit(create_quality_request("next"));
    const first_worker = MockWorker.instances[0];

    first_worker?.dispatch_error();

    await expect(broken_result).rejects.toMatchObject({
      name: "ProjectUiWorkerClientError",
      code: "execution_failed",
    });
    expect(first_worker?.terminated).toBe(true);

    const replacement_worker = MockWorker.instances[1];
    expect(read_quality_rule_keys(replacement_worker)).toEqual(["next"]);

    replacement_worker?.dispatch_message(2, "next-result");
    await expect(next_result).resolves.toBe("next-result");
    scheduler.dispose();
  });

  it("worker 执行失败时保留结构化诊断并只暴露稳定错误码", async () => {
    const scheduler = create_scheduler();
    const result = scheduler.submit(create_quality_request("broken"));
    const worker = MockWorker.instances[0];

    worker?.dispatch_failure(1);

    await expect(result).rejects.toMatchObject({
      name: "ProjectUiWorkerClientError",
      code: "execution_failed",
      message: "project_ui_worker_execution_failed",
      diagnostic: {
        message: "worker 爆炸",
        context: {
          worker_message_type: "quality.compute_statistics",
        },
      },
    });
    scheduler.dispose();
  });
});
