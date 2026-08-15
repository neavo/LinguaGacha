import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

import type { BackendWorkerExecution } from "../../worker/worker-execution";
import type { WorkUnit } from "../protocol/work-unit";
import type { WorkUnitExecutionResult } from "../protocol/work-unit-result";
import type { LLMClientPort } from "../../llm/llm-types";
import { WorkUnitRunner } from "./work-unit-runner";
import type { WorkUnitExecutor } from "./work-unit-executor";
import { WorkUnitExecutorTransportError } from "./work-unit-transport-error";
import { resolve_default_worker_count } from "../../../shared/utils/worker-capacity-tool";
import { AppError, normalize_log_error, to_log_error, type LogError } from "../../../shared/error";
import type { WorkUnitWorkerCommand, WorkUnitWorkerEvent } from "./work-unit-worker-protocol";

/**
 * worker 池只接收宿主已解析的执行模式和容量，不自行读取应用设置。
 */
interface WorkUnitWorkerPoolOptions {
  appRoot: string; // worker 与同进程 runner 共用的资源根
  execution: BackendWorkerExecution; // 明确选择 worker_threads 或 in_process
  llmClient: LLMClientPort; // 父线程真实模型请求入口
  workerCount?: number; // 只控制线程数，不是 LLM 并发上限
}

/**
 * 单个 work unit 在发送到 runner 后保留的 Promise 与取消上下文。
 */
interface PendingTask {
  id: string; // 跨线程消息与 Promise 的唯一关联键
  unit: WorkUnit; // 不可变 work-unit 载荷
  caller_signal: AbortSignal; // 只用于监听调用方取消并在完成后解绑
  execution_controller: AbortController; // 同时控制 runner、父线程 LLM 与池释放
  resolve: (value: unknown) => void; // 完成原 execute_unit Promise
  reject: (error: unknown) => void; // 归一传输或生命周期失败
  abort_listener: () => void; // 完成后必须移除，避免监听器泄漏
}

/**
 * 每个线程独立维护自己尚未返回的消息集合。
 */
interface WorkerSlot {
  worker: Worker; // 真实 worker_threads 句柄
  in_flight: Map<string, PendingTask>; // 该线程内 message id 到调用方 Promise 的映射
}

/**
 * multiplexed worker_threads 池：少量 worker 线程承载多个 in-flight LLM work unit。
 */
export class WorkUnitWorkerPool implements WorkUnitExecutor {
  private readonly app_root: string; // 提供 worker_threads 和同进程 runner 读取资源模板的根目录
  private readonly execution: BackendWorkerExecution; // 由入口层显式决定，池内不做入口探测或模式回退
  private readonly llm_client: LLMClientPort; // 正式 worker 只通过消息调用此父线程端口
  private readonly worker_count: number; // worker_threads 模式下的固定线程数
  private readonly slots: WorkerSlot[] = []; // worker_threads 模式下的固定线程集合
  private readonly in_process_runner: WorkUnitRunner | null = null; // 测试和源码执行的无跨线程路径
  private readonly in_process_in_flight = new Map<string, PendingTask>(); // 同进程任务的取消与释放索引
  private disposed = false; // 关闭入队入口，避免 Gateway stop 后继续派发新任务

  /**
   * 构造共享 worker_threads 容量，并按显式执行模式启动。
   */
  public constructor(options: WorkUnitWorkerPoolOptions) {
    this.app_root = options.appRoot;
    this.execution = options.execution;
    this.llm_client = options.llmClient;
    this.worker_count = resolve_default_worker_count({
      workerCount: options.workerCount,
      availableParallelism: os.availableParallelism?.() ?? os.cpus().length,
    });
    if (this.execution.kind === "in_process") {
      this.in_process_runner = new WorkUnitRunner({
        appRoot: this.app_root,
        llmClient: this.llm_client,
      });
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
    return (await this.enqueue(unit, signal)) as WorkUnitExecutionResult;
  }

  /**
   * Gateway stop 时拒绝在途任务并终止 worker，防止线程和 Promise 泄漏。
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const task of this.in_process_in_flight.values()) {
      task.execution_controller.abort();
      task.caller_signal.removeEventListener("abort", task.abort_listener);
      task.reject(this.create_disposed_error());
    }
    this.in_process_in_flight.clear();
    for (const slot of this.slots) {
      for (const task of slot.in_flight.values()) {
        task.execution_controller.abort();
        this.clear_task_listener(task);
        task.reject(this.create_disposed_error());
      }
      slot.in_flight.clear();
    }
    const terminate_results = await Promise.allSettled(
      this.slots.map((slot) => slot.worker.terminate()),
    );
    this.slots.length = 0;
    const terminate_errors = terminate_results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (terminate_errors.length > 0) {
      throw new AggregateError(terminate_errors, "Failed to terminate WorkUnitWorkerPool workers.");
    }
  }

  /**
   * 绑定取消监听并立即交给同进程 runner 或当前负载最小的 worker。
   */
  private enqueue(unit: WorkUnit, signal: AbortSignal): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(this.create_disposed_error());
    }
    return new Promise((resolve, reject) => {
      const task: PendingTask = {
        id: crypto.randomUUID(),
        unit,
        caller_signal: signal,
        execution_controller: new AbortController(),
        resolve,
        reject,
        abort_listener: () => {
          task.execution_controller.abort();
          this.cancel_task(task);
        },
      };
      if (signal.aborted) {
        reject(this.create_cancelled_error());
        return;
      }
      signal.addEventListener("abort", task.abort_listener, { once: true });
      if (this.in_process_runner !== null) {
        this.dispatch_in_process_task(task);
        return;
      }
      const slot = this.pick_least_loaded_slot();
      if (slot === null) {
        this.clear_task_listener(task);
        reject(this.create_disposed_error());
        return;
      }
      this.dispatch_worker_task(slot, task);
    });
  }

  /**
   * 真实 worker 线程派发只记录 message id 到 in_flight，完成时再按 id 取回 Promise。
   */
  private dispatch_worker_task(slot: WorkerSlot, task: PendingTask): void {
    slot.in_flight.set(task.id, task);
    slot.worker.postMessage({
      id: task.id,
      type: "execute",
      unit: task.unit,
    } satisfies WorkUnitWorkerCommand);
  }

  /**
   * 同进程 runner 用于测试和源码环境。
   */
  private dispatch_in_process_task(task: PendingTask): void {
    const runner = this.in_process_runner;
    if (runner === null) {
      return;
    }
    this.in_process_in_flight.set(task.id, task);
    const task_promise = runner.run(task.unit, task.execution_controller.signal);
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
   * 已派发 worker 任务发送对应 message id 的 cancel；同进程 runner 直接消费 signal。
   */
  private cancel_task(task: PendingTask): void {
    if (this.in_process_in_flight.has(task.id)) {
      return;
    }
    const slot = this.slots.find((item) => item.in_flight.has(task.id));
    slot?.worker.postMessage({ id: task.id, type: "cancel" } satisfies WorkUnitWorkerCommand);
  }

  /**
   * 创建单个 worker slot；slot 内可并发保存多个 pending task。
   */
  private create_slot(): WorkerSlot {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("WorkUnitWorkerPool requires worker_threads mode to create a worker slot.");
    }
    const slot: WorkerSlot = {
      worker: new Worker(this.execution.workUnitWorkerEntryUrl, {
        workerData: { appRoot: this.app_root },
      }),
      in_flight: new Map(),
    };
    slot.worker.on("message", (message: WorkUnitWorkerEvent) => {
      if (message.type === "llm_request") {
        void this.handle_llm_request(slot, message);
        return;
      }
      this.finish_slot_message(slot, message);
    });
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
    message: Extract<WorkUnitWorkerEvent, { type: "result" }>,
  ): void {
    const task = slot.in_flight.get(message.id);
    if (task === undefined) {
      return;
    }
    this.clear_worker_task(slot, task.id);
    this.settle_task(task, { id: message.id, ...message.result });
  }

  /** worker 的中性 LLM 请求由父线程真实 Client 执行，响应仍回到原 worker。 */
  private async handle_llm_request(
    slot: WorkerSlot,
    message: Extract<WorkUnitWorkerEvent, { type: "llm_request" }>,
  ): Promise<void> {
    const task = [...slot.in_flight.values()].find(
      ({ unit }) =>
        unit.run_id === message.body.run_id && unit.unit_id === message.body.work_unit_id,
    );
    let result: Extract<WorkUnitWorkerCommand, { type: "llm_result" }>["result"];
    if (task === undefined) {
      result = {
        ok: false,
        error: to_log_error(new Error("LLM request does not belong to an active work unit.")),
      };
    } else {
      try {
        result = {
          ok: true,
          data: await this.llm_client.request(message.body, task.execution_controller.signal),
        };
      } catch (error) {
        result = { ok: false, error: to_log_error(error, { execution: "llm_parent" }) };
      }
    }
    if (!this.slots.includes(slot)) {
      return;
    }
    slot.worker.postMessage({
      type: "llm_result",
      requestId: message.requestId,
      result,
    } satisfies WorkUnitWorkerCommand);
  }

  /**
   * 同进程 runner 完成后按 id 清理监听并结算原 Promise。
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
    this.settle_task(task, { id, ...message });
  }

  /**
   * worker 崩溃会拒绝该 slot 的全部 in-flight 任务，并补回固定线程数。
   */
  private fail_slot(slot: WorkerSlot, error: unknown): void {
    const failed_tasks = [...slot.in_flight.values()];
    slot.in_flight.clear();
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
    }
  }

  /**
   * 清理 worker slot 中单个任务及其 abort listener。
   */
  private clear_worker_task(slot: WorkerSlot, id: string): PendingTask | null {
    const task = slot.in_flight.get(id) ?? null;
    if (task !== null) {
      slot.in_flight.delete(id);
      this.clear_task_listener(task);
    }
    return task;
  }

  /**
   * 任务结束后必须移除 abort listener，避免后续 abort 触发已完成 Promise。
   */
  private clear_task_listener(task: PendingTask): void {
    task.caller_signal.removeEventListener("abort", task.abort_listener);
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
        normalize_log_error(message.error, "Work unit execution failed."),
        null,
      ),
    );
  }

  /**
   * WorkUnitWorkerPool 生命周期错误集中生成，调用方只按稳定 code 判断资源是否已释放。
   */
  private create_disposed_error(): AppError {
    return new AppError("runtime.disposed", {
      public_details: { resource: "WorkUnitWorkerPool" },
      diagnostic_context: {
        in_flight_count:
          this.in_process_in_flight.size +
          this.slots.reduce((count, slot) => count + slot.in_flight.size, 0),
      },
    });
  }

  /**
   * 主动取消和内部失败分离，避免取消路径被任务日志当作故障。
   */
  private create_cancelled_error(): AppError {
    return new AppError("runtime.cancelled", {
      public_details: { resource: "work_unit" },
    });
  }
}
