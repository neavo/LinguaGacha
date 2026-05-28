import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

import type { ApiJsonValue } from "../../api/api-types";
import type { CoreWorkerExecution } from "../../worker/worker-execution";
import type { WorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import { WorkUnitRunner } from "./work-unit-runner";
import type { WorkUnitExecutor } from "./work-unit-executor";
import { WorkUnitExecutorTransportError } from "./work-unit-transport-error";
import { resolve_default_worker_count } from "../../../shared/utils/worker-capacity-tool";
import {
  normalize_log_error,
  RuntimeCancelledError,
  RuntimeDisposedError,
  to_log_error,
  type LogError,
} from "../../../shared/error";
import type { WorkUnitLogEntry } from "../protocol/work-unit";
import type { SystemProxySnapshot } from "../../bootstrap/system-proxy-dispatcher";

interface WorkUnitWorkerPoolOptions {
  appRoot: string;
  execution: CoreWorkerExecution;
  systemProxySnapshot?: SystemProxySnapshot | null;
  workerCount?: number;
  maxInFlight?: number;
}

interface PendingTask {
  id: string;
  unit: WorkUnit | null;
  translate_single_body: Record<string, ApiJsonValue> | null;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
}

interface WorkerSlot {
  worker: Worker;
  in_flight: Map<string, PendingTask>;
}

/**
 * multiplexed worker_threads 池：少量 worker 线程承载多个 in-flight LLM work unit。
 */
export class WorkUnitWorkerPool implements WorkUnitExecutor {
  private readonly app_root: string; // app_root 提供 worker_threads 和同进程 runner 读取资源模板的根目录
  private readonly execution: CoreWorkerExecution; // execution 由入口层显式决定，池内不做入口探测或模式回退
  private readonly system_proxy_snapshot: SystemProxySnapshot | null; // system_proxy_snapshot 让 worker 线程复用主线程启动期代理快照
  private readonly worker_count: number; // worker_count 是 worker_threads 模式下的固定线程数
  private readonly max_in_flight: number; // max_in_flight 是全池并发上限，不等同于线程数
  private readonly queue: PendingTask[] = [];
  private readonly slots: WorkerSlot[] = [];
  private readonly in_process_runner: WorkUnitRunner | null = null;
  private readonly in_process_in_flight = new Map<string, PendingTask>(); // 同进程测试路径也遵守同一 in-flight 上限
  private in_flight_count = 0; // in_flight_count 是池内已派发但尚未完成的任务数，不含等待队列
  private disposed = false; // disposed 关闭入队入口，避免 Gateway stop 后继续派发新任务

  /**
   * 构造共享 worker_threads 容量与独立 in-flight 上限，并按显式执行模式启动。
   */
  public constructor(options: WorkUnitWorkerPoolOptions) {
    this.app_root = options.appRoot;
    this.execution = options.execution;
    this.system_proxy_snapshot = options.systemProxySnapshot ?? null;
    this.worker_count = resolve_default_worker_count({
      workerCount: options.workerCount,
      availableParallelism: os.availableParallelism?.() ?? os.cpus().length,
    });
    this.max_in_flight = Math.max(1, Math.trunc(options.maxInFlight ?? Number.MAX_SAFE_INTEGER));
    if (this.execution.kind === "in_process") {
      this.in_process_runner = new WorkUnitRunner({ appRoot: this.app_root });
      return;
    }
    for (let index = 0; index < this.worker_count; index += 1) {
      this.slots.push(this.create_slot());
    }
  }

  /**
   * 后台任务 unit 走统一 enqueue，WorkUnitWorkerPool 不读取任务领域状态。
   */
  public async execute_unit(unit: WorkUnit, signal: AbortSignal): Promise<WorkUnitExecutionResult> {
    return (await this.enqueue(unit, null, signal)) as WorkUnitExecutionResult;
  }

  /**
   * 单条翻译复用同一队列和 in-flight 计数，不绕过取消语义。
   */
  public async translate_single(
    body: Record<string, ApiJsonValue>,
    signal: AbortSignal,
  ): Promise<
    Record<string, ApiJsonValue> & {
      logs?: WorkUnitLogEntry[];
    }
  > {
    return (await this.enqueue(null, body, signal)) as Record<string, ApiJsonValue> & {
      logs?: WorkUnitLogEntry[];
    };
  }

  /**
   * Gateway stop 时拒绝等待队列并终止 worker，防止线程和 Promise 泄漏。
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    const queued = this.queue.splice(0, this.queue.length);
    for (const task of queued) {
      task.signal.removeEventListener("abort", task.abort_listener);
      task.reject(this.create_disposed_error());
    }
    for (const task of this.in_process_in_flight.values()) {
      task.signal.removeEventListener("abort", task.abort_listener);
      task.reject(this.create_disposed_error());
    }
    this.in_process_in_flight.clear();
    for (const slot of this.slots) {
      for (const task of slot.in_flight.values()) {
        this.clear_task_listener(task);
        task.reject(this.create_disposed_error());
      }
      slot.in_flight.clear();
    }
    await Promise.allSettled(this.slots.map((slot) => slot.worker.terminate()));
    this.slots.length = 0;
    this.in_flight_count = 0;
  }

  /**
   * 统一入队并绑定取消监听；是否直接执行由 drain_queue 决定。
   */
  private enqueue(
    unit: WorkUnit | null,
    translate_single_body: Record<string, ApiJsonValue> | null,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(this.create_disposed_error());
    }
    return new Promise((resolve, reject) => {
      const task: PendingTask = {
        id: crypto.randomUUID(),
        unit,
        translate_single_body,
        signal,
        resolve,
        reject,
        abort_listener: () => this.cancel_task(task),
      };
      if (signal.aborted) {
        reject(this.create_cancelled_error());
        return;
      }
      signal.addEventListener("abort", task.abort_listener, { once: true });
      this.queue.push(task);
      this.drain_queue();
    });
  }

  /**
   * 只要全池 in-flight 未达上限，就持续把队列派发给当前负载最小的 worker。
   */
  private drain_queue(): void {
    while (this.queue.length > 0 && this.in_flight_count < this.max_in_flight) {
      const task = this.queue.shift();
      if (task === undefined) {
        return;
      }
      if (this.in_process_runner !== null) {
        this.dispatch_in_process_task(task);
        continue;
      }
      const slot = this.pick_least_loaded_slot();
      if (slot === null) {
        this.queue.unshift(task);
        return;
      }
      this.dispatch_worker_task(slot, task);
    }
  }

  /**
   * 真实 worker 线程派发只记录 message id 到 in_flight，完成时再按 id 取回 Promise。
   */
  private dispatch_worker_task(slot: WorkerSlot, task: PendingTask): void {
    slot.in_flight.set(task.id, task);
    this.in_flight_count += 1;
    slot.worker.postMessage(
      task.unit === null
        ? { id: task.id, type: "translate_single", body: task.translate_single_body }
        : { id: task.id, type: "execute", unit: task.unit },
    );
  }

  /**
   * 同进程 runner 用于测试和源码环境，仍按同一个 in-flight 计数进入执行。
   */
  private dispatch_in_process_task(task: PendingTask): void {
    const runner = this.in_process_runner;
    if (runner === null) {
      return;
    }
    this.in_process_in_flight.set(task.id, task);
    this.in_flight_count += 1;
    const task_promise =
      task.unit === null
        ? runner.translate_single(task.translate_single_body ?? {}, task.signal)
        : runner.run(task.unit, task.signal);
    task_promise.then(
      (value) => this.finish_in_process_task(task.id, { ok: true, data: value }),
      (error: unknown) =>
        this.finish_in_process_task(task.id, {
          ok: false,
          error: to_log_error(error, { execution: "in_process" }),
        }),
    );
  }

  /**
   * 队列内取消直接拒绝，已派发任务只发送对应 message id 的 cancel。
   */
  private cancel_task(task: PendingTask): void {
    const queued_index = this.queue.findIndex((item) => item.id === task.id);
    if (queued_index >= 0) {
      this.queue.splice(queued_index, 1);
      task.signal.removeEventListener("abort", task.abort_listener);
      task.reject(this.create_cancelled_error());
      this.drain_queue();
      return;
    }
    if (this.in_process_in_flight.has(task.id)) {
      return;
    }
    const slot = this.slots.find((item) => item.in_flight.has(task.id));
    slot?.worker.postMessage({ id: task.id, type: "cancel" });
  }

  /**
   * 创建单个 worker slot；slot 内可并发保存多个 pending task。
   */
  private create_slot(): WorkerSlot {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("WorkUnitWorkerPool 创建 worker slot 时必须使用 worker_threads 执行模式。");
    }
    const slot: WorkerSlot = {
      worker: new Worker(this.execution.workUnitWorkerEntryUrl, {
        workerData: {
          appRoot: this.app_root,
          systemProxySnapshot: this.system_proxy_snapshot,
        },
      }),
      in_flight: new Map(),
    };
    slot.worker.on(
      "message",
      (message: { id: string; ok: boolean; data?: unknown; error?: LogError }) => {
        this.finish_slot_message(slot, message);
      },
    );
    slot.worker.on("error", (error) => {
      this.fail_slot(slot, error);
    });
    slot.worker.on("exit", (code) => {
      if (!this.disposed && code !== 0) {
        this.fail_slot(slot, new Error(`Task worker exited unexpectedly: ${code.toString()}`));
      }
    });
    return slot;
  }

  /**
   * 派发时选择当前 in-flight 最少的 worker，避免单线程热点。
   */
  private pick_least_loaded_slot(): WorkerSlot | null {
    if (this.slots.length === 0) {
      return null;
    }
    return (
      [...this.slots].sort((left, right) => left.in_flight.size - right.in_flight.size)[0] ?? null
    );
  }

  /**
   * worker 消息按 id 完成对应任务，迟到或未知 id 直接忽略。
   */
  private finish_slot_message(
    slot: WorkerSlot,
    message: {
      id: string;
      ok: boolean;
      data?: unknown;
      error?: LogError;
    },
  ): void {
    const task = slot.in_flight.get(message.id);
    if (task === undefined) {
      return;
    }
    this.clear_worker_task(slot, task.id);
    this.settle_task(task, message);
    this.drain_queue();
  }

  /**
   * 同进程 runner 完成后释放全池 in-flight，并继续推进等待队列。
   */
  private finish_in_process_task(
    id: string,
    message: { ok: boolean; data?: unknown; error?: LogError },
  ): void {
    const task = this.in_process_in_flight.get(id);
    if (task === undefined) {
      return;
    }
    this.in_process_in_flight.delete(id);
    this.clear_task_listener(task);
    this.in_flight_count = Math.max(0, this.in_flight_count - 1);
    this.settle_task(task, { id, ...message });
    this.drain_queue();
  }

  /**
   * worker 崩溃会拒绝该 slot 的全部 in-flight 任务，并补回固定线程数。
   */
  private fail_slot(slot: WorkerSlot, error: unknown): void {
    const failed_tasks = [...slot.in_flight.values()];
    slot.in_flight.clear();
    this.in_flight_count = Math.max(0, this.in_flight_count - failed_tasks.length);
    for (const task of failed_tasks) {
      this.clear_task_listener(task);
      task.reject(
        new WorkUnitExecutorTransportError(
          to_log_error(error, { worker_failure: "slot_error" }),
          error,
        ),
      );
    }
    const index = this.slots.indexOf(slot);
    if (index >= 0 && !this.disposed) {
      this.slots[index] = this.create_slot();
      this.drain_queue();
    }
  }

  /**
   * 清理 worker slot 中单个任务的 listener 与全池 in-flight 计数。
   */
  private clear_worker_task(slot: WorkerSlot, id: string): PendingTask | null {
    const task = slot.in_flight.get(id) ?? null;
    if (task !== null) {
      slot.in_flight.delete(id);
      this.clear_task_listener(task);
      this.in_flight_count = Math.max(0, this.in_flight_count - 1);
    }
    return task;
  }

  /**
   * 任务结束后必须移除 abort listener，避免后续 abort 触发已完成 Promise。
   */
  private clear_task_listener(task: PendingTask): void {
    task.signal.removeEventListener("abort", task.abort_listener);
  }

  /**
   * 成功值和传输错误在 WorkUnitWorkerPool 边界统一完成，Engine 只识别 executor 结果。
   */
  private settle_task(
    task: PendingTask,
    message: {
      id: string;
      ok: boolean;
      data?: unknown;
      error?: LogError;
    },
  ): void {
    if (message.ok) {
      task.resolve(message.data);
      return;
    }
    task.reject(
      new WorkUnitExecutorTransportError(
        normalize_log_error(message.error, "work unit 执行失败。"),
        null,
      ),
    );
  }

  /**
   * WorkUnitWorkerPool 生命周期错误集中生成，调用方只按稳定 code 判断资源是否已释放。
   */
  private create_disposed_error(): RuntimeDisposedError {
    return new RuntimeDisposedError({
      public_details: { resource: "WorkUnitWorkerPool" },
      diagnostic_context: {
        queue_length: this.queue.length,
        in_flight_count: this.in_flight_count,
      },
    });
  }

  /**
   * 主动取消和内部失败分离，避免取消路径被任务日志当作故障。
   */
  private create_cancelled_error(): RuntimeCancelledError {
    return new RuntimeCancelledError({
      public_details: { resource: "work_unit" },
    });
  }
}
