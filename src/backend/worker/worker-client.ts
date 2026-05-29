import crypto from "node:crypto";
import { Worker } from "node:worker_threads";

import {
  normalize_log_error,
  RuntimeCancelledError,
  RuntimeDisposedError,
  WorkerExecutionFailedError,
} from "../../shared/error";
import type { BackendWorkerExecution } from "./worker-execution";
import {
  run_worker_task,
  type BackendWorkerTask,
  type BackendWorkerTaskResult,
} from "./worker-task";
import type { BackendWorkerIncomingMessage, BackendWorkerOutgoingMessage } from "./worker-entry";

type BackendWorkerClientOptions = {
  execution: BackendWorkerExecution;
};

type PendingTask = {
  id: string;
  task: BackendWorkerTask;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
};

export class BackendWorkerClient {
  private readonly execution: BackendWorkerExecution;
  private readonly queue: PendingTask[] = [];
  private worker: Worker | null = null;
  private active_task: PendingTask | null = null;
  private disposed = false;

  public constructor(options: BackendWorkerClientOptions) {
    this.execution = options.execution;
    if (this.execution.kind === "worker_threads") {
      this.worker = this.create_worker();
    }
  }

  public run<TTask extends BackendWorkerTask>(
    task: TTask,
    signal: AbortSignal,
  ): Promise<BackendWorkerTaskResult<TTask>> {
    if (this.disposed) {
      return Promise.reject(this.create_disposed_error());
    }
    if (signal.aborted) {
      return Promise.reject(this.create_cancelled_error());
    }
    return new Promise((resolve, reject) => {
      const pending: PendingTask = {
        id: crypto.randomUUID(),
        task,
        signal,
        resolve: (value) => resolve(value as BackendWorkerTaskResult<TTask>),
        reject,
        abort_listener: () => this.cancel_task(pending),
      };
      signal.addEventListener("abort", pending.abort_listener, { once: true });
      this.queue.push(pending);
      this.drain_queue();
    });
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const task of this.queue.splice(0, this.queue.length)) {
      this.reject_task(task, this.create_disposed_error());
    }
    if (this.active_task !== null) {
      this.reject_task(this.active_task, this.create_disposed_error());
      this.active_task = null;
    }
    await this.worker?.terminate();
    this.worker = null;
  }

  private drain_queue(): void {
    if (this.active_task !== null) {
      return;
    }
    const task = this.queue.shift();
    if (task === undefined) {
      return;
    }
    this.active_task = task;
    if (this.execution.kind === "in_process") {
      void this.execute_in_process(task);
      return;
    }
    this.worker?.postMessage({
      id: task.id,
      type: "run",
      task: task.task,
    } satisfies BackendWorkerIncomingMessage);
  }

  private async execute_in_process(task: PendingTask): Promise<void> {
    try {
      if (task.signal.aborted) {
        throw this.create_cancelled_error();
      }
      const data = await run_worker_task(task.task);
      this.finish_task(task.id, data, null);
    } catch (error) {
      this.finish_task(task.id, null, error);
    }
  }

  private cancel_task(task: PendingTask): void {
    const queued_index = this.queue.findIndex((item) => item.id === task.id);
    if (queued_index >= 0) {
      this.queue.splice(queued_index, 1);
      this.reject_task(task, this.create_cancelled_error());
      return;
    }
    if (this.active_task?.id !== task.id) {
      return;
    }
    if (this.execution.kind === "worker_threads") {
      this.worker?.postMessage({
        id: task.id,
        type: "cancel",
      } satisfies BackendWorkerIncomingMessage);
    }
    this.active_task = null;
    this.reject_task(task, this.create_cancelled_error());
    this.drain_queue();
  }

  private create_worker(): Worker {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("BackendWorkerClient 创建 worker 时必须使用 worker_threads。");
    }
    const worker = new Worker(this.execution.backendWorkerEntryUrl);
    worker.on("message", (message: BackendWorkerOutgoingMessage) => {
      this.finish_worker_message(message);
    });
    worker.on("error", (error) => this.fail_worker(worker, error));
    worker.on("exit", (code) => {
      if (!this.disposed && code !== 0) {
        this.fail_worker(worker, new Error(`Backend worker exited: ${code.toString()}`));
      }
    });
    return worker;
  }

  private finish_worker_message(message: BackendWorkerOutgoingMessage): void {
    const task = this.active_task;
    if (task === null || task.id !== message.id) {
      return;
    }
    if (message.ok) {
      this.finish_task(task.id, message.data, null);
    } else {
      this.finish_task(
        task.id,
        null,
        new WorkerExecutionFailedError({
          diagnostic_context: {
            failure: normalize_log_error(message.error, "Backend worker 执行失败。"),
          },
        }),
      );
    }
  }

  private finish_task(id: string, data: unknown, error: unknown): void {
    const task = this.active_task;
    if (task === null || task.id !== id) {
      return;
    }
    this.active_task = null;
    task.signal.removeEventListener("abort", task.abort_listener);
    if (error === null) {
      task.resolve(data);
    } else {
      task.reject(error);
    }
    this.drain_queue();
  }

  private fail_worker(worker: Worker, error: unknown): void {
    if (this.worker !== worker) {
      return;
    }
    const task = this.active_task;
    this.active_task = null;
    if (task !== null) {
      this.reject_task(task, error);
    }
    if (!this.disposed && this.execution.kind === "worker_threads") {
      this.worker = this.create_worker();
      this.drain_queue();
    }
  }

  private reject_task(task: PendingTask, error: unknown): void {
    task.signal.removeEventListener("abort", task.abort_listener);
    task.reject(error);
  }

  private create_disposed_error(): RuntimeDisposedError {
    return new RuntimeDisposedError({
      public_details: { resource: "BackendWorkerClient" },
      diagnostic_context: { queue_length: this.queue.length },
    });
  }

  private create_cancelled_error(): RuntimeCancelledError {
    return new RuntimeCancelledError({
      public_details: { resource: "backend_worker" },
    });
  }
}
