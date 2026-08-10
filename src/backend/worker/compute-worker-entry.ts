import { parentPort } from "node:worker_threads";

import { to_log_error } from "../../shared/error";
import {
  run_compute_worker_task,
  type ComputeWorkerTask,
  type ComputeWorkerTaskResultByType,
} from "./compute-worker-task";

export type ComputeWorkerRunMessage = {
  id: string;
  type: "run";
  task: ComputeWorkerTask;
};

export type ComputeWorkerCancelMessage = {
  id: string;
  type: "cancel";
};

export type ComputeWorkerIncomingMessage = ComputeWorkerRunMessage | ComputeWorkerCancelMessage;

export type ComputeWorkerOutgoingMessage =
  | {
      id: string;
      ok: true;
      data: ComputeWorkerTaskResultByType[keyof ComputeWorkerTaskResultByType];
    }
  | {
      id: string;
      ok: false;
      error: ReturnType<typeof to_log_error>;
    };

type ComputeWorkerTaskState = { cancelled: boolean };

const task_states = new Map<string, ComputeWorkerTaskState>(); // 只保留执行中的任务，迟到 cancel 不产生陈旧状态。

function handle_message(message: ComputeWorkerIncomingMessage): void {
  if (message.type === "cancel") {
    const state = task_states.get(message.id);
    if (state !== undefined) state.cancelled = true;
    return;
  }
  void execute_message(message);
}

async function execute_message(message: ComputeWorkerRunMessage): Promise<void> {
  const state: ComputeWorkerTaskState = { cancelled: false };
  task_states.set(message.id, state);
  try {
    assert_not_cancelled(state);
    const data = await run_compute_worker_task(message.task);
    assert_not_cancelled(state);
    post_message({ id: message.id, ok: true, data });
  } catch (error) {
    post_message({
      id: message.id,
      ok: false,
      error: to_log_error(error, { worker_task_type: message.task.type }),
    });
  } finally {
    task_states.delete(message.id);
  }
}

function assert_not_cancelled(state: ComputeWorkerTaskState): void {
  if (state.cancelled) {
    throw new Error("Compute worker task was cancelled.");
  }
}

function post_message(message: ComputeWorkerOutgoingMessage): void {
  parentPort?.postMessage(message);
}

parentPort?.on("message", (message: ComputeWorkerIncomingMessage) => {
  handle_message(message);
});
