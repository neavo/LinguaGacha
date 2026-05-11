import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

import type { ApiJsonValue } from "../api/api-types";
import type {
  AnalysisWorkUnitResult,
  TranslationWorkUnitResult,
} from "./work-unit/work-unit-types";
import { WorkUnitRunner } from "./work-unit/work-unit-runner";
import {
  WorkUnitExecutorTransportError,
  type TaskWorkUnitExecutor,
} from "./task-work-unit-executor";

// worker 池只关心运行环境依赖，任务语义由 body 里的 method 和 runner 决定。
interface TaskWorkerPoolOptions {
  appRoot: string;
  workerCount?: number;
}

// 等待派发的 work unit，保存 resolve/reject 是为了 worker 消息回来后完成原 Promise。
interface PendingTask {
  id: string;
  method: string;
  body: Record<string, ApiJsonValue>;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
}

// 一个 slot 对应一个 worker 线程和它当前承载的任务。
interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  current_task: PendingTask | null;
}

/**
 * 固定 worker_threads 池，承载所有 work unit 的确定性处理。
 */
export class TaskWorkerPool implements TaskWorkUnitExecutor {
  private readonly options: Required<TaskWorkerPoolOptions>;
  private readonly queue: PendingTask[] = [];
  private readonly slots: WorkerSlot[] = [];
  private readonly direct_runner: WorkUnitRunner | null = null;
  private disposed = false;

  /**
   * 构造时立即创建固定数量 worker，避免任务运行中动态膨胀。
   */
  public constructor(options: TaskWorkerPoolOptions) {
    this.options = {
      ...options,
      workerCount: Math.max(1, Math.trunc(options.workerCount ?? 4)),
    };
    const worker_entry_url = new URL("./task-worker-entry.js", import.meta.url);
    if (this.should_use_direct_runner(worker_entry_url)) {
      this.direct_runner = new WorkUnitRunner({
        appRoot: this.options.appRoot,
      });
      return;
    }
    for (let index = 0; index < this.options.workerCount; index += 1) {
      this.slots.push(this.create_slot());
    }
  }

  /**
   * Vitest 全局环境可能把 import.meta.url 伪装成非 file URL；该场景只能回退源码 runner。
   */
  private should_use_direct_runner(worker_entry_url: URL): boolean {
    try {
      return !existsSync(fileURLToPath(worker_entry_url));
    } catch {
      return true;
    }
  }

  /**
   * 翻译 chunk 走 worker 执行，返回结构由 runner 保证。
   */
  public async execute_translation_chunk(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    return (await this.enqueue(
      "execute_translation_chunk",
      body,
      signal,
    )) as TranslationWorkUnitResult;
  }

  /**
   * 分析 chunk 走同一 worker 池，不新建并行执行体系。
   */
  public async execute_analysis_chunk(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<AnalysisWorkUnitResult> {
    return (await this.enqueue("execute_analysis_chunk", body, signal)) as AnalysisWorkUnitResult;
  }

  /**
   * 重翻单条 item 复用翻译 runner，提交仍在 TaskEngine。
   */
  public async execute_retranslate_item(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<TranslationWorkUnitResult> {
    return (await this.enqueue(
      "execute_retranslate_item",
      body,
      signal,
    )) as TranslationWorkUnitResult;
  }

  /**
   * 单条翻译不占后台锁，但仍复用 worker 确定性链路。
   */
  public async translate_single(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<
    Record<string, ApiJsonValue> & {
      logs?: Array<{ level: "info" | "warning" | "error"; message: string }>;
    }
  > {
    return (await this.enqueue("translate_single", body, signal)) as Record<
      string,
      ApiJsonValue
    > & {
      logs?: Array<{ level: "info" | "warning" | "error"; message: string }>;
    };
  }

  /**
   * Gateway stop 时销毁 worker，避免 Electron 退出留下线程。
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    const errors = this.queue.splice(0, this.queue.length);
    for (const task of errors) {
      task.signal.removeEventListener("abort", task.abort_listener);
      task.reject(new Error("TaskWorkerPool 已关闭。"));
    }
    await Promise.allSettled(this.slots.map((slot) => slot.worker.terminate()));
    this.slots.length = 0;
  }

  /**
   * 入队统一绑定 AbortSignal；任务未分配时取消直接从队列移除。
   */
  private enqueue(
    method: string,
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("TaskWorkerPool 已关闭。"));
    }
    return new Promise((resolve, reject) => {
      if (this.direct_runner !== null) {
        this.direct_runner.run(method, body, signal).then(resolve, reject);
        return;
      }
      const task: PendingTask = {
        id: crypto.randomUUID(),
        method,
        body,
        signal,
        resolve,
        reject,
        abort_listener: () => {
          this.cancel_task(task);
        },
      };
      if (signal.aborted) {
        reject(new Error("work unit 已取消。"));
        return;
      }
      signal.addEventListener("abort", task.abort_listener, { once: true });
      this.queue.push(task);
      this.drain_queue();
    });
  }

  /**
   * 有空闲 worker 时持续派发队列任务。
   */
  private drain_queue(): void {
    for (const slot of this.slots) {
      if (slot.busy) {
        continue;
      }
      const task = this.queue.shift();
      if (task === undefined) {
        return;
      }
      slot.busy = true;
      slot.current_task = task;
      slot.worker.postMessage({ id: task.id, type: "run", method: task.method, body: task.body });
    }
  }

  /**
   * 取消未开始任务时直接拒绝，已开始任务则发 cancel 消息给 worker。
   */
  private cancel_task(task: PendingTask): void {
    const queued_index = this.queue.findIndex((item) => item.id === task.id);
    if (queued_index >= 0) {
      this.queue.splice(queued_index, 1);
      task.reject(new Error("work unit 已取消。"));
      return;
    }
    const slot = this.slots.find((item) => item.current_task?.id === task.id);
    slot?.worker.postMessage({ id: task.id, type: "cancel" });
  }

  /**
   * 创建 worker 并绑定消息和崩溃恢复逻辑。
   */
  private create_slot(): WorkerSlot {
    const slot: WorkerSlot = {
      worker: new Worker(new URL("./task-worker-entry.js", import.meta.url), {
        workerData: {
          appRoot: this.options.appRoot,
        },
      }),
      busy: false,
      current_task: null,
    };
    slot.worker.on(
      "message",
      (message: { id: string; ok: boolean; data?: unknown; error?: string }) => {
        this.finish_slot_message(slot, message);
      },
    );
    slot.worker.on("error", (error) => {
      this.fail_slot(slot, error);
    });
    slot.worker.on("exit", (code) => {
      if (!this.disposed && code !== 0) {
        this.fail_slot(slot, new Error(`task worker 异常退出：${code.toString()}`));
      }
    });
    return slot;
  }

  /**
   * worker 返回消息后解除当前任务并继续派发队列。
   */
  private finish_slot_message(
    slot: WorkerSlot,
    message: { id: string; ok: boolean; data?: unknown; error?: string },
  ): void {
    const task = slot.current_task;
    if (task === null || task.id !== message.id) {
      return;
    }
    this.clear_slot_task(slot);
    if (message.ok) {
      task.resolve(message.data);
    } else {
      task.reject(
        new WorkUnitExecutorTransportError(message.error ?? "work unit 执行失败。", null),
      );
    }
    this.drain_queue();
  }

  /**
   * worker 崩溃时拒绝当前任务，并用新 worker 补齐固定池容量。
   */
  private fail_slot(slot: WorkerSlot, error: unknown): void {
    const task = slot.current_task;
    if (task !== null) {
      this.clear_slot_task(slot);
      task.reject(new WorkUnitExecutorTransportError("task worker 线程失败。", error));
    }
    const index = this.slots.indexOf(slot);
    if (index >= 0 && !this.disposed) {
      this.slots[index] = this.create_slot();
      this.drain_queue();
    }
  }

  /**
   * 清理当前任务和 abort listener，避免任务结束后继续收到取消事件。
   */
  private clear_slot_task(slot: WorkerSlot): PendingTask | null {
    const task = slot.current_task;
    if (task !== null) {
      task.signal.removeEventListener("abort", task.abort_listener);
    }
    slot.busy = false;
    slot.current_task = null;
    return task;
  }
}
