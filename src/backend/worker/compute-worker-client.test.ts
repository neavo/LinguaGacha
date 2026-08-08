import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { ComputeWorkerClient } from "./compute-worker-client";
import type { ComputeWorkerTask } from "./compute-worker-task";

const worker_threads_mock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeWorker {
    static instances: FakeWorker[] = [];

    readonly posted_messages: unknown[] = [];
    private readonly listeners = new Map<string, Listener[]>();

    constructor(_url: URL) {
      FakeWorker.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    postMessage(message: unknown): void {
      this.posted_messages.push(message);
    }

    async terminate(): Promise<number> {
      this.emit("exit", 0);
      return 0;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
  }

  return { FakeWorker };
});

vi.mock("node:worker_threads", () => ({
  default: { Worker: worker_threads_mock.FakeWorker },
  Worker: worker_threads_mock.FakeWorker,
}));

/**
 * 构造可真实执行的质量统计任务，队列测试只隔离 worker client 调度行为。
 */
function create_quality_task(pattern: string): ComputeWorkerTask {
  return {
    type: "quality_rule_analysis",
    input: {
      ...prepare_quality_statistics_task_input({
        rule_key: "glossary",
        entries: [{ entry_id: pattern, src: pattern }],
        items: [{ src: `${pattern} appeared`, dst: "" }],
      }),
      include_relations: true,
    },
  };
}

describe("ComputeWorkerClient", () => {
  beforeEach(() => {
    worker_threads_mock.FakeWorker.instances.length = 0;
  });

  it("在 in_process 模式下按提交顺序执行后台 task", async () => {
    const client = new ComputeWorkerClient({ execution: { kind: "in_process" } });

    const first = client.run(create_quality_task("HP"), new AbortController().signal);
    const second = client.run(create_quality_task("MP"), new AbortController().signal);

    await expect(first).resolves.toMatchObject({
      entry_ids: ["HP"],
      hits_by_entry_id: { HP: 1 },
    });
    await expect(second).resolves.toMatchObject({
      entry_ids: ["MP"],
      hits_by_entry_id: { MP: 1 },
    });

    await client.dispose();
  });

  it("取消排队 task 时拒绝该任务且继续完成已有任务", async () => {
    const client = new ComputeWorkerClient({ execution: { kind: "in_process" } });
    const first = client.run(create_quality_task("HP"), new AbortController().signal);
    const controller = new AbortController();
    const queued = client.run(create_quality_task("MP"), controller.signal);

    controller.abort();

    await expect(first).resolves.toMatchObject({
      hits_by_entry_id: { HP: 1 },
    });
    await expect(queued).rejects.toMatchObject({ code: "runtime.cancelled" });

    await client.dispose();
  });

  it("取消 active task 时拒绝该任务并继续执行后续任务", async () => {
    const client = new ComputeWorkerClient({ execution: { kind: "in_process" } });
    const controller = new AbortController();
    const active = client.run(create_quality_task("HP"), controller.signal);
    const next = client.run(create_quality_task("MP"), new AbortController().signal);

    controller.abort();

    await expect(active).rejects.toMatchObject({ code: "runtime.cancelled" });
    await expect(next).resolves.toMatchObject({
      hits_by_entry_id: { MP: 1 },
    });

    await client.dispose();
  });

  it("dispose 后拒绝排队和后续提交的 task", async () => {
    const client = new ComputeWorkerClient({ execution: { kind: "in_process" } });
    const running = client.run(create_quality_task("HP"), new AbortController().signal);
    const queued = client.run(create_quality_task("MP"), new AbortController().signal);

    await client.dispose();

    await expect(running).rejects.toMatchObject({ code: "runtime.disposed" });
    await expect(queued).rejects.toMatchObject({ code: "runtime.disposed" });
    await expect(
      client.run(create_quality_task("TP"), new AbortController().signal),
    ).rejects.toMatchObject({ code: "runtime.disposed" });
  });

  it("worker 即使以 code 0 意外退出也拒绝活动任务并重建线程", async () => {
    const client = new ComputeWorkerClient({
      execution: {
        kind: "worker_threads",
        computeWorkerEntryUrl: new URL("file:///compute-worker-entry.js"),
        planningWorkerEntryUrl: new URL("file:///planning-worker-entry.js"),
        workUnitWorkerEntryUrl: new URL("file:///work-unit-worker-entry.js"),
      },
    });
    const first_worker = worker_threads_mock.FakeWorker.instances[0];
    if (first_worker === undefined) throw new Error("缺少初始 Compute worker。");
    const task = client.run(create_quality_task("HP"), new AbortController().signal);

    first_worker.emit("exit", 0);

    await expect(task).rejects.toThrow("Compute worker exited: 0");
    expect(worker_threads_mock.FakeWorker.instances).toHaveLength(2);
    await client.dispose();
  });
});
