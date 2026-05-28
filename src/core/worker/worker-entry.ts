import { parentPort } from "node:worker_threads";

import { to_log_error } from "../../shared/error";
import {
  run_worker_task,
  type CoreWorkerTask,
  type CoreWorkerTaskResultByType,
} from "./worker-task";

export type CoreWorkerRunMessage = {
  id: string;
  type: "run";
  task: CoreWorkerTask;
};

export type CoreWorkerCancelMessage = {
  id: string;
  type: "cancel";
};

export type CoreWorkerIncomingMessage = CoreWorkerRunMessage | CoreWorkerCancelMessage;

export type CoreWorkerOutgoingMessage =
  | {
      id: string;
      ok: true;
      data: CoreWorkerTaskResultByType[keyof CoreWorkerTaskResultByType];
    }
  | {
      id: string;
      ok: false;
      error: ReturnType<typeof to_log_error>;
    };

const cancelled_ids = new Set<string>(); // 取消只标记单个任务，worker 生命周期由 CoreWorkerClient 管理。

function handle_message(message: CoreWorkerIncomingMessage): void {
  if (message.type === "cancel") {
    cancelled_ids.add(message.id);
    return;
  }
  void execute_message(message);
}

async function execute_message(message: CoreWorkerRunMessage): Promise<void> {
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
    throw new Error("Core worker 任务已取消。");
  }
}

function post_message(message: CoreWorkerOutgoingMessage): void {
  parentPort?.postMessage(message);
}

parentPort?.on("message", (message: CoreWorkerIncomingMessage) => {
  handle_message(message);
});
