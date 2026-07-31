import { afterEach, describe, expect, it, vi } from "vitest";

import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import type { ComputeWorkerIncomingMessage } from "./compute-worker-entry";
import type { ComputeWorkerTask } from "./compute-worker-task";

type WorkerPortHarness = {
  listener: ((message: ComputeWorkerIncomingMessage) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  emit: (message: ComputeWorkerIncomingMessage) => void;
};

function install_worker_threads_mock(): WorkerPortHarness {
  const harness: WorkerPortHarness = {
    listener: null,
    postMessage: vi.fn(),
    emit(message) {
      harness.listener?.(message);
    },
  };
  const parent_port = {
    on: vi.fn((event_name: string, listener: (message: ComputeWorkerIncomingMessage) => void) => {
      if (event_name === "message") {
        harness.listener = listener;
      }
    }),
    postMessage: harness.postMessage,
  };
  vi.doMock("node:worker_threads", () => ({
    default: { parentPort: parent_port },
    parentPort: parent_port,
  }));
  return harness;
}

function create_task(): ComputeWorkerTask {
  return {
    type: "quality_statistics",
    input: prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [{ entry_id: "hp", src: "HP" }],
      items: [{ src: "HP + 1", dst: "" }],
    }),
  };
}

async function flush_worker_microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Compute worker entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("./compute-worker-task");
  });

  it("按消息 id 回传 task 结果", async () => {
    const harness = install_worker_threads_mock();
    const task = create_task();
    const run_compute_worker_task = vi.fn(async () => ({ phase: "current" }));
    vi.doMock("./compute-worker-task", () => ({ run_compute_worker_task }));

    await import("./compute-worker-entry");
    harness.emit({ id: "task-1", type: "run", task });
    await flush_worker_microtasks();

    expect(run_compute_worker_task).toHaveBeenCalledWith(task);
    expect(harness.postMessage).toHaveBeenCalledWith({
      id: "task-1",
      ok: true,
      data: { phase: "current" },
    });
  });

  it("运行中取消后返回结构化错误", async () => {
    const harness = install_worker_threads_mock();
    const task = create_task();
    const task_completion: {
      resolve: ((value: Record<string, unknown>) => void) | null;
    } = { resolve: null };
    const run_compute_worker_task = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          task_completion.resolve = resolve;
        }),
    );
    vi.doMock("./compute-worker-task", () => ({ run_compute_worker_task }));

    await import("./compute-worker-entry");
    harness.emit({ id: "task-2", type: "run", task });
    await Promise.resolve();
    harness.emit({ id: "task-2", type: "cancel" });
    task_completion.resolve?.({ phase: "current" });
    await flush_worker_microtasks();

    expect(harness.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "task-2",
        ok: false,
        error: expect.objectContaining({
          message: "Compute worker 任务已取消。",
          context: { worker_task_type: "quality_statistics" },
        }),
      }),
    );
  });

  it("完成后的迟到取消不污染后续任务状态", async () => {
    const harness = install_worker_threads_mock();
    const task = create_task();
    const run_compute_worker_task = vi.fn(async () => ({ phase: "current" }));
    vi.doMock("./compute-worker-task", () => ({ run_compute_worker_task }));

    await import("./compute-worker-entry");
    harness.emit({ id: "reused-id", type: "run", task });
    await flush_worker_microtasks();
    harness.emit({ id: "reused-id", type: "cancel" });
    harness.emit({ id: "reused-id", type: "run", task });
    await flush_worker_microtasks();

    expect(run_compute_worker_task).toHaveBeenCalledTimes(2);
    expect(harness.postMessage).toHaveBeenLastCalledWith({
      id: "reused-id",
      ok: true,
      data: { phase: "current" },
    });
  });
});
