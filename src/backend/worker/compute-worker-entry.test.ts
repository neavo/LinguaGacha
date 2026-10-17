import { afterEach, describe, expect, it, vi } from "vitest";

import { prepare_quality_statistics_task_input } from "../../shared/quality/quality-statistics-input";
import { install_worker_threads_mock } from "../../test/worker-port-harness";
import type { ComputeWorkerIncomingMessage } from "./compute-worker-entry";
import type { ComputeWorkerTask } from "./compute-worker-task";

function create_task(): ComputeWorkerTask {
  return {
    type: "quality_rule_statistics",
    input: {
      ...prepare_quality_statistics_task_input({
        rule_key: "glossary",
        entries: [{ entry_id: "hp", src: "HP" }],
        items: [{ src: "HP + 1", dst: "" }],
      }),
      include_subset_parents: true,
    },
  };
}

describe("Compute worker entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("./compute-worker-task");
  });

  it("按消息 id 回传 task 结果", async () => {
    const harness = install_worker_threads_mock<ComputeWorkerIncomingMessage>();
    const task = create_task();
    const run_compute_worker_task = vi.fn(async () => ({ phase: "current" }));
    vi.doMock("./compute-worker-task", () => ({ run_compute_worker_task }));

    await import("./compute-worker-entry");
    harness.emit({ id: "task-1", type: "run", task });
    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith({
        id: "task-1",
        ok: true,
        data: { phase: "current" },
      });
    });
    expect(run_compute_worker_task).toHaveBeenCalledWith(task);
  });

  it("运行中取消后返回结构化错误", async () => {
    const harness = install_worker_threads_mock<ComputeWorkerIncomingMessage>();
    const task = create_task();
    const task_completion = Promise.withResolvers<Record<string, unknown>>();
    const run_compute_worker_task = vi.fn(() => task_completion.promise);
    vi.doMock("./compute-worker-task", () => ({ run_compute_worker_task }));

    await import("./compute-worker-entry");
    harness.emit({ id: "task-2", type: "run", task });
    await vi.waitFor(() => {
      expect(run_compute_worker_task).toHaveBeenCalledWith(task);
    });
    harness.emit({ id: "task-2", type: "cancel" });
    task_completion.resolve({ phase: "current" });
    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "task-2",
          ok: false,
          error: expect.objectContaining({
            message: "Compute worker task was cancelled.",
            context: { worker_task_type: "quality_rule_statistics" },
          }),
        }),
      );
    });
  });

  it("完成后的迟到取消不污染后续任务状态", async () => {
    const harness = install_worker_threads_mock<ComputeWorkerIncomingMessage>();
    const task = create_task();
    const run_compute_worker_task = vi.fn(async () => ({ phase: "current" }));
    vi.doMock("./compute-worker-task", () => ({ run_compute_worker_task }));

    await import("./compute-worker-entry");
    harness.emit({ id: "reused-id", type: "run", task });
    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledTimes(1);
      expect(harness.postMessage).toHaveBeenLastCalledWith({
        id: "reused-id",
        ok: true,
        data: { phase: "current" },
      });
    });
    harness.emit({ id: "reused-id", type: "cancel" });
    harness.emit({ id: "reused-id", type: "run", task });
    await vi.waitFor(() => {
      expect(harness.postMessage).toHaveBeenCalledTimes(2);
      expect(harness.postMessage).toHaveBeenLastCalledWith({
        id: "reused-id",
        ok: true,
        data: { phase: "current" },
      });
    });
    expect(run_compute_worker_task).toHaveBeenCalledTimes(2);
  });
});
