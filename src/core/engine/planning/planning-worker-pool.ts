import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

import {
  normalize_error_diagnostic,
  RuntimeCancelledError,
  RuntimeDisposedError,
  WorkerExecutionFailedError,
} from "../../../shared/error";
import { resolve_default_worker_count } from "../../../shared/worker-capacity";
import type { EngineExecution } from "../core/engine-execution";
import { create_o200k_base_token_counter, type TokenCounter } from "../core/token-counter";
import type {
  PlanningWorkerIncomingMessage,
  PlanningWorkerOutgoingMessage,
} from "./planning-worker-types";
import type { TaskTokenCountInput, TaskTokenCountResult } from "./token-metric-cache";

const PLANNING_CHUNK_SIZE = 2000; // 单条消息大小兼顾线程负载均衡和 postMessage 序列化成本。
const IN_PROCESS_YIELD_EVERY_ITEMS = 256; // 同进程计数每处理一批主动让出事件循环，保证取消语义可观察。

interface PlanningWorkerPoolOptions {
  execution: EngineExecution;
  workerCount?: number;
}

interface PendingPlanningTask {
  id: string;
  items: TaskTokenCountInput[];
  signal: AbortSignal;
  resolve: (value: TaskTokenCountResult[]) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
}

interface PlanningWorkerSlot {
  worker: Worker;
  task: PendingPlanningTask | null;
}

/**
 * planning worker 池把精确 token 计数移出 Core 主线程，线程只计算，不拥有项目事实。
 */
export class PlanningWorkerPool {
  private readonly execution: EngineExecution; // execution 由启动入口显式注入，构建产物路径不在池内猜测。
  private readonly worker_count: number; // worker_count 控制 CPU 计数并行度，不等同于 LLM 请求并发。
  private readonly queue: PendingPlanningTask[] = [];
  private readonly slots: PlanningWorkerSlot[] = [];
  private readonly in_process_counter: TokenCounter | null = null;
  private readonly in_process_in_flight = new Map<string, PendingPlanningTask>(); // 同进程模式也使用同一取消和释放入口。
  private disposed = false; // disposed 关闭后拒绝新任务，避免 CoreServices 释放后继续计数。

  /**
   * 根据 execution 创建 worker_threads 或同进程计数器，产品路径固定走 worker_threads。
   */
  public constructor(options: PlanningWorkerPoolOptions) {
    this.execution = options.execution;
    this.worker_count = resolve_default_worker_count({
      workerCount: options.workerCount,
      availableParallelism: os.availableParallelism?.() ?? os.cpus().length,
    });
    if (this.execution.kind === "in_process") {
      this.in_process_counter = create_o200k_base_token_counter();
      return;
    }
    for (let index = 0; index < this.worker_count; index += 1) {
      this.slots.push(this.create_slot());
    }
  }

  /**
   * 对外暴露批量 token 计数；调用方拿到的只是 cache_key 到 token_count 的值对象。
   */
  public async count_items(
    items: TaskTokenCountInput[],
    signal: AbortSignal,
  ): Promise<TaskTokenCountResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = this.split_items(items);
    const results = await Promise.all(chunks.map((chunk) => this.enqueue(chunk, signal)));
    return results.flat();
  }

  /**
   * CoreServices 释放时拒绝队列、终止 worker，避免 CLI 或 GUI 退出后残留线程。
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const task of this.queue.splice(0, this.queue.length)) {
      this.reject_task(task, this.create_disposed_error());
    }
    for (const task of this.in_process_in_flight.values()) {
      this.reject_task(task, this.create_disposed_error());
    }
    this.in_process_in_flight.clear();
    for (const slot of this.slots) {
      if (slot.task !== null) {
        this.reject_task(slot.task, this.create_disposed_error());
        slot.task = null;
      }
    }
    await Promise.allSettled(this.slots.map((slot) => slot.worker.terminate()));
    this.slots.length = 0;
  }

  /**
   * 入队时绑定 AbortSignal；是否立即派发由 drain_queue 统一决定。
   */
  private enqueue(
    items: TaskTokenCountInput[],
    signal: AbortSignal,
  ): Promise<TaskTokenCountResult[]> {
    if (this.disposed) {
      return Promise.reject(this.create_disposed_error());
    }
    if (signal.aborted) {
      return Promise.reject(this.create_cancelled_error());
    }
    return new Promise((resolve, reject) => {
      const task: PendingPlanningTask = {
        id: crypto.randomUUID(),
        items,
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

  /**
   * 空闲 worker 会持续消费队列；同进程模式一次只执行一个批次，方便测试观察。
   */
  private drain_queue(): void {
    if (this.in_process_counter !== null) {
      this.drain_in_process_queue();
      return;
    }
    for (const slot of this.slots) {
      if (slot.task !== null || this.queue.length === 0) {
        continue;
      }
      const task = this.queue.shift();
      if (task !== undefined) {
        this.dispatch_worker_task(slot, task);
      }
    }
  }

  /**
   * worker_threads 派发只发送最小文本载荷，TaskPlanner 仍留在主线程解释规划结果。
   */
  private dispatch_worker_task(slot: PlanningWorkerSlot, task: PendingPlanningTask): void {
    slot.task = task;
    const message: PlanningWorkerIncomingMessage = {
      id: task.id,
      type: "count_tokens",
      items: task.items,
    };
    slot.worker.postMessage(message);
  }

  /**
   * 同进程计数路径只为测试和显式源码执行保留，仍分批让出事件循环。
   */
  private drain_in_process_queue(): void {
    if (this.in_process_in_flight.size > 0) {
      return;
    }
    const task = this.queue.shift();
    if (task === undefined) {
      return;
    }
    this.in_process_in_flight.set(task.id, task);
    void this.count_in_process(task);
  }

  /**
   * 同进程模式复用同一个 tokenizer，方便单元测试验证取消和队列行为。
   */
  private async count_in_process(task: PendingPlanningTask): Promise<void> {
    const counter = this.in_process_counter;
    if (counter === null) {
      return;
    }
    try {
      const results: TaskTokenCountResult[] = [];
      for (const [index, item] of task.items.entries()) {
        if (task.signal.aborted) {
          throw this.create_cancelled_error();
        }
        results.push({ cache_key: item.cache_key, token_count: counter.count(item.text) });
        if (index > 0 && index % IN_PROCESS_YIELD_EVERY_ITEMS === 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      this.finish_in_process_task(task.id, results, null);
    } catch (error) {
      this.finish_in_process_task(task.id, null, error);
    }
  }

  /**
   * Abort 对已派发 worker 立即拒绝主线程 Promise，worker 迟到返回会被忽略。
   */
  private cancel_task(task: PendingPlanningTask): void {
    const queued_index = this.queue.findIndex((item) => item.id === task.id);
    if (queued_index >= 0) {
      this.queue.splice(queued_index, 1);
      this.reject_task(task, this.create_cancelled_error());
      return;
    }
    if (this.in_process_in_flight.delete(task.id)) {
      this.reject_task(task, this.create_cancelled_error());
      this.drain_queue();
      return;
    }
    const slot = this.slots.find((item) => item.task?.id === task.id);
    if (slot === undefined || slot.task === null) {
      return;
    }
    slot.worker.postMessage({
      id: task.id,
      type: "cancel",
    } satisfies PlanningWorkerIncomingMessage);
    const cancelled_task = slot.task;
    slot.task = null;
    this.reject_task(cancelled_task, this.create_cancelled_error());
    this.drain_queue();
  }

  /**
   * 创建单个 planning worker slot，slot 一次只处理一个 token 计数批次。
   */
  private create_slot(): PlanningWorkerSlot {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("PlanningWorkerPool 创建 worker slot 时必须使用 worker_threads 执行模式。");
    }
    const slot: PlanningWorkerSlot = {
      worker: new Worker(this.execution.planningWorkerEntryUrl),
      task: null,
    };
    slot.worker.on("message", (message: PlanningWorkerOutgoingMessage) => {
      this.finish_worker_message(slot, message);
    });
    slot.worker.on("error", (error) => this.fail_slot(slot, error));
    slot.worker.on("exit", (code) => {
      if (!this.disposed && code !== 0) {
        this.fail_slot(slot, new Error(`Planning worker exited unexpectedly: ${code.toString()}`));
      }
    });
    return slot;
  }

  /**
   * worker 返回后释放 slot 并继续消费队列；未知 id 属于取消后的迟到消息。
   */
  private finish_worker_message(
    slot: PlanningWorkerSlot,
    message: PlanningWorkerOutgoingMessage,
  ): void {
    const task = slot.task;
    if (task === null || task.id !== message.id) {
      return;
    }
    slot.task = null;
    task.signal.removeEventListener("abort", task.abort_listener);
    if (message.ok) {
      task.resolve(message.data ?? []);
    } else {
      task.reject(
        new WorkerExecutionFailedError({
          diagnostic_context: {
            failure: normalize_error_diagnostic(
              message.error_diagnostic,
              "planning worker 计数失败。",
            ),
          },
        }),
      );
    }
    this.drain_queue();
  }

  /**
   * worker 异常只影响当前 slot 的批次，并补回固定线程数。
   */
  private fail_slot(slot: PlanningWorkerSlot, error: unknown): void {
    const task = slot.task;
    slot.task = null;
    if (task !== null) {
      this.reject_task(task, error);
    }
    const index = this.slots.indexOf(slot);
    if (index >= 0 && !this.disposed) {
      this.slots[index] = this.create_slot();
      this.drain_queue();
    }
  }

  /**
   * 同进程批次完成后只结算仍在 in-flight 表中的任务，避免取消后重复 settle。
   */
  private finish_in_process_task(
    id: string,
    results: TaskTokenCountResult[] | null,
    error: unknown,
  ): void {
    const task = this.in_process_in_flight.get(id);
    if (task === undefined) {
      return;
    }
    this.in_process_in_flight.delete(id);
    task.signal.removeEventListener("abort", task.abort_listener);
    if (error === null) {
      task.resolve(results ?? []);
    } else {
      task.reject(error);
    }
    this.drain_queue();
  }

  /**
   * 拒绝任务前必须移除 abort listener，避免释放后再次进入 cancel_task。
   */
  private reject_task(task: PendingPlanningTask, error: unknown): void {
    task.signal.removeEventListener("abort", task.abort_listener);
    task.reject(error);
  }

  /**
   * 大输入切成多个消息批次，让多个 worker 可以分担同一轮任务规划。
   */
  private split_items(items: TaskTokenCountInput[]): TaskTokenCountInput[][] {
    const chunks: TaskTokenCountInput[][] = [];
    for (let index = 0; index < items.length; index += PLANNING_CHUNK_SIZE) {
      chunks.push(items.slice(index, index + PLANNING_CHUNK_SIZE));
    }
    return chunks;
  }

  /**
   * 释放后的错误使用稳定 shared AppError，调用方可按资源名定位问题。
   */
  private create_disposed_error(): RuntimeDisposedError {
    return new RuntimeDisposedError({
      public_details: { resource: "PlanningWorkerPool" },
      diagnostic_context: { queue_length: this.queue.length },
    });
  }

  /**
   * 主动取消和执行失败分离，避免任务日志把停止视作异常崩溃。
   */
  private create_cancelled_error(): RuntimeCancelledError {
    return new RuntimeCancelledError({
      public_details: { resource: "planning_worker" },
    });
  }
}
