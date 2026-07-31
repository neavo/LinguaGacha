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
  run_compute_worker_task,
  type ComputeWorkerTask,
  type ComputeWorkerTaskResult,
} from "./compute-worker-task";
import type {
  ComputeWorkerIncomingMessage,
  ComputeWorkerOutgoingMessage,
} from "./compute-worker-entry";

type ComputeWorkerClientOptions = {
  execution: BackendWorkerExecution;
};

type PendingTask = {
  id: string; // 隔离迟到的 worker 响应，只有当前任务 id 可以结算
  task: ComputeWorkerTask;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
};

/**
 * Compute worker 的单飞 FIFO 门面；线程与进程内执行共享同一取消、结算和销毁语义。
 */
export class ComputeWorkerClient {
  private readonly execution: BackendWorkerExecution;
  private readonly queue: PendingTask[] = [];
  private worker: Worker | null = null;
  private active_task: PendingTask | null = null; // 单飞所有者，后续任务必须等待它结算
  private disposed = false; // 销毁后拒绝新任务，也禁止异常退出时重建 worker

  public constructor(options: ComputeWorkerClientOptions) {
    this.execution = options.execution;
    if (this.execution.kind === "worker_threads") {
      this.worker = this.create_worker();
    }
  }

  /** 排队执行一个可取消计算；同一 client 永远只结算一个 active task。 */
  public run<TTask extends ComputeWorkerTask>(
    task: TTask,
    signal: AbortSignal,
  ): Promise<ComputeWorkerTaskResult<TTask>> {
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
        resolve: (value) => resolve(value as ComputeWorkerTaskResult<TTask>),
        reject,
        abort_listener: () => this.cancel_task(pending),
      };
      signal.addEventListener("abort", pending.abort_listener, { once: true });
      this.queue.push(pending);
      this.drain_queue();
    });
  }

  /** 拒绝所有未结算任务并终止线程；销毁后的实例不可复用。 */
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

  /** 每次只派发一个任务，使两种执行模式维持相同顺序。 */
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
    } satisfies ComputeWorkerIncomingMessage);
  }

  private async execute_in_process(task: PendingTask): Promise<void> {
    try {
      if (task.signal.aborted) {
        throw this.create_cancelled_error();
      }
      const data = await run_compute_worker_task(task.task);
      this.finish_task(task.id, data, null);
    } catch (error) {
      this.finish_task(task.id, null, error);
    }
  }

  /** 排队任务本地移除；活动线程任务发 cancel，并让迟到结果因 id 不匹配而失效。 */
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
      } satisfies ComputeWorkerIncomingMessage);
    }
    this.active_task = null;
    this.reject_task(task, this.create_cancelled_error());
    this.drain_queue();
  }

  private create_worker(): Worker {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("ComputeWorkerClient 创建线程时必须使用 worker_threads。");
    }
    const worker = new Worker(this.execution.computeWorkerEntryUrl);
    worker.on("message", (message: ComputeWorkerOutgoingMessage) => {
      this.finish_worker_message(message);
    });
    worker.on("error", (error) => this.fail_worker(worker, error));
    worker.on("exit", (code) => {
      // code 0 也可能是当前活动线程意外结束；只有 dispose 主动终止才可忽略。
      if (!this.disposed) {
        this.fail_worker(worker, new Error(`Compute worker exited: ${code.toString()}`));
      }
    });
    return worker;
  }

  private finish_worker_message(message: ComputeWorkerOutgoingMessage): void {
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
            failure: normalize_log_error(message.error, "Compute worker 执行失败。"),
          },
        }),
      );
    }
  }

  /** 只结算当前任务，隔离取消、线程重建或旧 worker 产生的迟到消息。 */
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

  /** 当前线程失败时拒绝活动任务并重建；旧线程事件不能影响新实例。 */
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
      public_details: { resource: "ComputeWorkerClient" },
      diagnostic_context: { queue_length: this.queue.length },
    });
  }

  private create_cancelled_error(): RuntimeCancelledError {
    return new RuntimeCancelledError({
      public_details: { resource: "compute_worker" },
    });
  }
}
