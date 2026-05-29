import { parentPort } from "node:worker_threads";

import { to_log_error } from "../../shared/error";
import {
  run_worker_task,
  type BackendWorkerTask,
  type BackendWorkerTaskResultByType,
} from "./worker-task";

export type BackendWorkerRunMessage = {
  id: string;
  type: "run";
  task: BackendWorkerTask;
};

export type BackendWorkerCancelMessage = {
  id: string;
  type: "cancel";
};

export type BackendWorkerIncomingMessage = BackendWorkerRunMessage | BackendWorkerCancelMessage;

export type BackendWorkerOutgoingMessage =
  | {
      id: string;
      ok: true;
      data: BackendWorkerTaskResultByType[keyof BackendWorkerTaskResultByType];
    }
  | {
      id: string;
      ok: false;
      error: ReturnType<typeof to_log_error>;
    };

const cancelled_ids = new Set<string>(); // 取消只标记单个任务，worker 生命周期由 BackendWorkerClient 管理。

function handle_message(message: BackendWorkerIncomingMessage): void {
  if (message.type === "cancel") {
    cancelled_ids.add(message.id);
    return;
  }
  void execute_message(message);
}

async function execute_message(message: BackendWorkerRunMessage): Promise<void> {
  try {
    assert_not_cancelled(message.id);
    const data = await run_worker_task(message.task);
    assert_not_cancelled(message.id);
    post_message({ id: message.id, ok: true, data });
  } catch (error) {
    post_message({
      id: message.id,
      ok: false,
      error: to_log_error(error, { worker_task_type: message.task.type }),
    });
  } finally {
    cancelled_ids.delete(message.id);
  }
}

function assert_not_cancelled(id: string): void {
  if (cancelled_ids.has(id)) {
    throw new Error("Backend worker 任务已取消。");
  }
}

function post_message(message: BackendWorkerOutgoingMessage): void {
  parentPort?.postMessage(message);
}

parentPort?.on("message", (message: BackendWorkerIncomingMessage) => {
  handle_message(message);
});
