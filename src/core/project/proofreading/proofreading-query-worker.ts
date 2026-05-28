import crypto from "node:crypto";
import { Worker } from "node:worker_threads";

import {
  normalize_log_error,
  RuntimeCancelledError,
  RuntimeDisposedError,
  WorkerExecutionFailedError,
} from "../../../shared/error";
import type { CoreWorkerExecution } from "../../worker/core-worker-execution";
import { ProofreadingQueryWorkerCache } from "./proofreading-query-worker-cache";
import type {
  ProofreadingQueryWorkerDisposeInput,
  ProofreadingQueryWorkerIncomingMessage,
  ProofreadingQueryWorkerOutgoingMessage,
  ProofreadingQueryWorkerQueryInput,
  ProofreadingQueryWorkerQueryResult,
  ProofreadingQueryWorkerSyncInput,
  ProofreadingQueryWorkerSyncResult,
} from "./proofreading-query-worker-protocol";

type WorkerTaskMessage = Exclude<ProofreadingQueryWorkerIncomingMessage, { type: "cancel" }>;

interface PendingTask {
  id: string;
  message: WorkerTaskMessage;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
}

export class ProofreadingQueryWorker {
  private readonly execution: CoreWorkerExecution;
  private readonly queue: PendingTask[] = [];
  private readonly in_process_cache = new ProofreadingQueryWorkerCache();
  private worker: Worker | null = null;
  private active_task: PendingTask | null = null;
  private disposed = false;

  public constructor(options: { execution: CoreWorkerExecution }) {
    this.execution = options.execution;
    if (this.execution.kind === "worker_threads") {
      this.worker = this.create_worker();
    }
  }

  public syncProofreadingCache(
    key: string,
    input: ProofreadingQueryWorkerSyncInput,
    signal: AbortSignal,
  ): Promise<ProofreadingQueryWorkerSyncResult> {
    return this.enqueue(
      { id: "", type: "proofreading.sync", key, input },
      signal,
    ) as Promise<ProofreadingQueryWorkerSyncResult>;
  }

  public queryProofreadingCache(
    key: string,
    input: ProofreadingQueryWorkerQueryInput,
    signal: AbortSignal,
  ): Promise<ProofreadingQueryWorkerQueryResult> {
    return this.enqueue(
      { id: "", type: "proofreading.query", key, input },
      signal,
    ) as Promise<ProofreadingQueryWorkerQueryResult>;
  }

  public async disposeProofreadingCache(input: ProofreadingQueryWorkerDisposeInput): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.enqueue(
      { id: "", type: "proofreading.dispose", input },
      new AbortController().signal,
    );
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

  private enqueue(message: WorkerTaskMessage, signal: AbortSignal): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(this.create_disposed_error());
    }
    if (signal.aborted) {
      return Promise.reject(this.create_cancelled_error());
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const task: PendingTask = {
        id,
        message: { ...message, id },
        signal,
        resolve,
        reject,
        abort_listener: () => this.cancel_task(task),
      };
      signal.addEventListener("abort", task.abort_listener, { once: true });
      this.queue.push(task);
      this.drain_queue();
    });
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
    this.worker?.postMessage(task.message);
  }

  private async execute_in_process(task: PendingTask): Promise<void> {
    try {
      if (task.signal.aborted) {
        throw this.create_cancelled_error();
      }
      const data = this.run_in_process_task(task.message);
      this.finish_task(task.id, data, null);
    } catch (error) {
      this.finish_task(task.id, null, error);
    }
  }

  private run_in_process_task(message: WorkerTaskMessage): unknown {
    if (message.type === "proofreading.sync") {
      return this.in_process_cache.sync(message.key, message.input);
    }
    if (message.type === "proofreading.query") {
      return this.in_process_cache.query(message.key, message.input);
    }
    this.in_process_cache.dispose(message.input);
    return {};
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
      } satisfies ProofreadingQueryWorkerIncomingMessage);
    }
    this.active_task = null;
    this.reject_task(task, this.create_cancelled_error());
    this.drain_queue();
  }

  private create_worker(): Worker {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("ProofreadingQueryWorker 创建 worker 时必须使用 worker_threads。");
    }
    const worker = new Worker(this.execution.proofreadingQueryWorkerEntryUrl);
    worker.on("message", (message: ProofreadingQueryWorkerOutgoingMessage) => {
      this.finish_worker_message(message);
    });
    worker.on("error", (error) => this.fail_worker(worker, error));
    worker.on("exit", (code) => {
      if (!this.disposed && code !== 0) {
        this.fail_worker(worker, new Error(`Proofreading query worker exited: ${code.toString()}`));
      }
    });
    return worker;
  }

  private finish_worker_message(message: ProofreadingQueryWorkerOutgoingMessage): void {
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
            failure: normalize_log_error(message.error, "校对 query worker 执行失败。"),
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
      public_details: { resource: "ProofreadingQueryWorker" },
      diagnostic_context: { queue_length: this.queue.length },
    });
  }

  private create_cancelled_error(): RuntimeCancelledError {
    return new RuntimeCancelledError({
      public_details: { resource: "proofreading_query_worker" },
    });
  }
}
