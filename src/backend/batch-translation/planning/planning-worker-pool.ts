import os from "node:os";
import { Worker } from "node:worker_threads";

import { AppError, normalize_log_error } from "../../../shared/error";
import { resolve_default_worker_count } from "../../../shared/utils/worker-capacity-tool";
import type { BackendWorkerExecution } from "../../worker/worker-execution";
import type {
  PlanningWorkerIncomingMessage,
  PlanningWorkerOutgoingMessage,
} from "./planning-worker-types";

const BATCH_ITEM_LIMIT = 2000;
const BATCH_TEXT_LENGTH_LIMIT = 256 * 1024; // UTF-16 长度限制消息规模；单条长文本始终完整计数。
const BATCH_TEXT_LENGTH_MIN = 4096;
const BATCHES_PER_WORKER = 4;

type PendingBatch = {
  id: number; // 匹配回包，隔离已结束批次的迟到消息。
  length: number; // 消费边界要求每条文本恰好对应一个计数。
  resolve: (counts: readonly number[]) => void;
  reject: (error: unknown) => void;
};

type WorkerSlot = {
  worker: Worker;
  pending: PendingBatch | null; // 等待真实回包或 exit 后才释放。
  closed: boolean; // 只由 exit 确认，下次有工作时重建。
  error: unknown; // error 先于 exit 到达，保留原始原因到退出结算。
};

/** 单 run 互斥下只接受一次规划计数；多个执行循环按需领取批次，无逐批队列或取消监听。 */
export class PlanningWorkerPool {
  private readonly execution: BackendWorkerExecution; // 入口决定执行环境和发布资产位置。
  private readonly worker_count: number; // CPU 并行上限，与模型请求并发独立。
  private readonly slots: WorkerSlot[] = []; // 按需创建的线程，跨规划复用词表。
  private next_batch_id = 0; // 跨请求递增，取消后不复用消息身份。
  private active: { controller: AbortController; completion: Promise<number[]> } | null = null; // 请求取消与完成共用一个所有者。
  private closing: Promise<void> | null = null; // 同时表达停止受理和可重复等待的关闭过程。

  /** 只确定执行容量，实际线程由首次缺失计数启动。 */
  public constructor(options: { execution: BackendWorkerExecution; workerCount?: number }) {
    this.execution = options.execution;
    this.worker_count = resolve_default_worker_count({
      workerCount: options.workerCount,
      availableParallelism: os.availableParallelism(),
    });
  }

  /** 同序返回全部结果，失败或取消等待活动批次收束后才释放本次请求。 */
  public async count_items(texts: readonly string[], signal: AbortSignal): Promise<number[]> {
    if (this.closing !== null) throw this.disposed_error();
    if (this.active !== null) throw new AppError("runtime.busy");
    if (signal.aborted) throw this.cancelled_error();
    if (texts.length === 0) return [];
    const controller = new AbortController();
    const abort = () => controller.abort(this.cancelled_error());
    signal.addEventListener("abort", abort, { once: true });
    // 先登记 active 再进入异步执行，dispose 和同步取消均能观察同一完成链。
    const completion = Promise.resolve().then(() => this.count_request(texts, controller));
    this.active = { controller, completion };
    try {
      return await completion;
    } finally {
      signal.removeEventListener("abort", abort);
      this.active = null;
    }
  }

  /** 同步停止受理并取消活动请求，重复关闭复用同一完成链。 */
  public dispose(): Promise<void> {
    if (this.closing === null) {
      // 先关闭受理入口，再同步取消；abort 回调中的重入也必须看到关闭状态。
      this.closing = Promise.resolve().then(() => this.close());
      this.active?.controller.abort(this.disposed_error());
    }
    return this.closing;
  }

  /** 终止线程后等待活动执行收束，关闭失败保留每个终止原因。 */
  private async close(): Promise<void> {
    const active = this.active;
    const terminations = await Promise.allSettled(
      this.slots.map((slot) => slot.worker.terminate()),
    );
    // 活动请求的失败由调用者消费；关闭仍必须等待同进程执行或线程回包完成。
    if (active !== null) await Promise.allSettled([active.completion]);
    this.slots.length = 0;
    const errors = terminations
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0)
      throw new AggregateError(errors, "Failed to terminate planning workers.");
  }

  /** 按文本量划分可领取批次；任一失败取消同请求的其它执行循环。 */
  private async count_request(
    texts: readonly string[],
    controller: AbortController,
  ): Promise<number[]> {
    const { signal } = controller;
    signal.throwIfAborted();
    if (this.execution.kind === "in_process") {
      const { count_token_batch } = await import("./token-counter");
      return await count_token_batch(texts, signal);
    }
    const total_length = texts.reduce((sum, text) => sum + text.length, 0);
    const batch_length = Math.max(
      BATCH_TEXT_LENGTH_MIN,
      Math.min(
        BATCH_TEXT_LENGTH_LIMIT,
        Math.ceil(total_length / (this.worker_count * BATCHES_PER_WORKER)),
      ),
    );
    const results: number[] = [];
    let next_index = 0; // 执行循环在首次 await 前领取不重叠的输入范围。
    const cancel_batches = () => {
      for (const slot of this.slots) {
        if (!slot.closed && slot.pending !== null) {
          slot.worker.postMessage({
            id: slot.pending.id,
            type: "cancel",
          } satisfies PlanningWorkerIncomingMessage);
        }
      }
    };
    signal.addEventListener("abort", cancel_batches, { once: true });
    const run_lane = async (index: number): Promise<void> => {
      try {
        while (next_index < texts.length) {
          signal.throwIfAborted();
          const start = next_index;
          let length = 0;
          do {
            length += texts[next_index]!.length;
            next_index += 1;
          } while (
            next_index < texts.length &&
            next_index - start < BATCH_ITEM_LIMIT &&
            length + texts[next_index]!.length <= batch_length
          );
          // 只为有工作可领的执行循环创建线程；后续请求复用该线程的词表和 BPE 缓存。
          const counts = await this.count_batch(index, texts.slice(start, next_index));
          signal.throwIfAborted();
          for (const [offset, count] of counts.entries()) results[start + offset] = count;
        }
      } catch (error) {
        // 首个失败取消其它执行循环；全部活动批次收束后，由请求完成链抛出同一原因。
        controller.abort(error);
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(this.worker_count, texts.length) }, (_, index) =>
          run_lane(index),
        ),
      );
      signal.throwIfAborted();
      return results;
    } finally {
      signal.removeEventListener("abort", cancel_batches);
    }
  }

  /** 每个 slot 只派发一个批次，结果沿原输入位置回填。 */
  private count_batch(index: number, texts: readonly string[]): Promise<readonly number[]> {
    let slot = this.slots[index];
    if (slot === undefined || slot.closed) {
      slot = this.create_slot();
      this.slots[index] = slot;
    }
    const current_slot = slot;
    return new Promise<readonly number[]>((resolve, reject) => {
      const id = ++this.next_batch_id;
      current_slot.pending = { id, length: texts.length, resolve, reject };
      try {
        current_slot.worker.postMessage({
          id,
          type: "count_tokens",
          texts,
        } satisfies PlanningWorkerIncomingMessage);
      } catch (error) {
        current_slot.pending = null; // 派发失败没有对应回包，立即释放批次引用。
        reject(error);
      }
    });
  }

  /** 将线程消息和退出事件收口为批次结算，异常退出也必须结束等待。 */
  private create_slot(): WorkerSlot {
    if (this.execution.kind !== "worker_threads") throw new AppError("runtime.internal_invariant");
    const slot: WorkerSlot = {
      worker: new Worker(this.execution.planningWorkerEntryUrl),
      pending: null,
      closed: false,
      error: null,
    };
    slot.worker.on("message", (message: PlanningWorkerOutgoingMessage) => {
      const pending = slot.pending;
      if (pending === null || message.id !== pending.id) return; // 已完成批次的迟到消息无消费方。
      slot.pending = null;
      if (
        message.status === "done" &&
        message.counts.length === pending.length &&
        message.counts.every((count) => Number.isSafeInteger(count) && count >= 0)
      ) {
        pending.resolve(message.counts);
      } else if (message.status === "cancelled") {
        pending.reject(this.cancelled_error());
      } else {
        pending.reject(
          new AppError("worker.execution_failed", {
            diagnostic_context:
              message.status === "error"
                ? { failure: normalize_log_error(message.error, "Planning token counting failed.") }
                : { batch_id: pending.id },
          }),
        );
      }
    });
    // Worker 的 error 后必有 exit；等待 exit 才释放批次，避免故障线程与下次请求重叠。
    slot.worker.on("error", (error) => {
      slot.error = error;
    });
    slot.worker.on("exit", (code) => {
      slot.closed = true;
      slot.pending?.reject(slot.error ?? new Error(`Planning worker exited: ${code.toString()}`));
      slot.pending = null;
    });
    return slot;
  }

  /** 对外沿用运行资源已释放的错误契约。 */
  private disposed_error(): AppError {
    return new AppError("runtime.disposed", { public_details: { resource: "PlanningWorkerPool" } });
  }

  /** 用户取消与执行异常分开结算。 */
  private cancelled_error(): AppError {
    return new AppError("runtime.cancelled", { public_details: { resource: "planning_worker" } });
  }
}
