import type { TaskPipelineWorkerResult } from "./task-engine-types";

const DEFAULT_COMMIT_INTERVAL_MS = 250;

interface TaskPipelineOptions<TContext, TCommit> {
  worker_count: number;
  signal: AbortSignal;
  execute: (
    context: TContext,
    signal: AbortSignal,
  ) => Promise<TaskPipelineWorkerResult<TContext, TCommit>>;
  commit: (entries: TCommit[]) => Promise<void>;
  commit_interval_ms?: number;
}

/**
 * Task Engine 通用流水线，负责普通队列、高优重试队列、worker pool 和批量提交。
 */
export class TaskPipeline<TContext, TCommit> {
  // queue 保存初次 work unit，停止时会被直接清空。
  private readonly queue: TContext[] = [];

  // retry_queue 优先级高于普通队列，保证失败拆分能尽快收敛。
  private readonly retry_queue: TContext[] = [];

  // commit_queue 聚合 worker 产物，再按固定窗口批量提交。
  private readonly commit_queue: TCommit[] = [];

  private readonly worker_count: number;
  private readonly upstream_signal: AbortSignal;
  private readonly abort_controller: AbortController;
  private readonly signal: AbortSignal;
  private readonly execute: (
    context: TContext,
    signal: AbortSignal,
  ) => Promise<TaskPipelineWorkerResult<TContext, TCommit>>;
  private readonly commit: (entries: TCommit[]) => Promise<void>;
  private readonly commit_interval_ms: number;
  private readonly upstream_abort_listener: () => void;
  private commit_timer: ReturnType<typeof setTimeout> | null = null;
  private commit_promise: Promise<void> = Promise.resolve();
  private commit_error: unknown = null;
  private worker_error: unknown = null;

  /**
   * 注入执行和提交回调，流水线本身不理解翻译、分析或重翻领域。
   */
  public constructor(options: TaskPipelineOptions<TContext, TCommit>) {
    this.worker_count = Math.max(1, Math.trunc(options.worker_count));
    this.upstream_signal = options.signal;
    this.abort_controller = new AbortController();
    this.signal = this.abort_controller.signal;
    this.execute = options.execute;
    this.commit = options.commit;
    this.commit_interval_ms = options.commit_interval_ms ?? DEFAULT_COMMIT_INTERVAL_MS;
    this.upstream_abort_listener = () => {
      this.abort_pipeline();
    };
    if (this.upstream_signal.aborted) {
      this.abort_pipeline();
    } else {
      this.upstream_signal.addEventListener("abort", this.upstream_abort_listener, { once: true });
    }
  }

  /**
   * 执行完整流水线；所有 worker 停止后会强制冲刷最后一批提交。
   */
  public async run(initial_contexts: TContext[]): Promise<void> {
    this.queue.push(...initial_contexts);
    const workers = Array.from({ length: this.worker_count }, () => this.run_worker());
    const worker_results = await Promise.allSettled(workers);
    this.capture_worker_errors(worker_results);
    try {
      this.clear_commit_timer();
      await this.commit_promise;
      this.throw_commit_error_if_any();
      await this.flush_commit_queue();
      this.throw_commit_error_if_any();
      this.throw_worker_error_if_any();
    } finally {
      this.detach_upstream_abort_listener();
    }
  }

  /**
   * 单个 worker 持续优先消费 retry 队列，直到队列耗尽或收到停止信号。
   */
  private async run_worker(): Promise<void> {
    try {
      for (;;) {
        if (this.signal.aborted) {
          this.clear_queues();
          return;
        }
        const context = this.next_context();
        if (context === null) {
          return;
        }
        this.throw_commit_error_if_any();
        const result = await this.execute(context, this.signal);
        if (this.signal.aborted) {
          return;
        }
        if (result.commit_entries.length > 0) {
          this.push_commit_entries(result.commit_entries);
        }
        if (result.retry_contexts.length > 0) {
          this.retry_queue.push(...result.retry_contexts);
        }
      }
    } catch (error) {
      this.abort_pipeline(error);
      throw error;
    }
  }

  /**
   * 取下一份上下文；重试队列优先，普通队列次之。
   */
  private next_context(): TContext | null {
    return this.retry_queue.shift() ?? this.queue.shift() ?? null;
  }

  /**
   * work unit 结果进入提交队列后启动 250ms 聚合窗口。
   */
  private push_commit_entries(entries: TCommit[]): void {
    this.commit_queue.push(...entries);
    if (this.commit_timer !== null) {
      return;
    }
    this.commit_timer = setTimeout(() => {
      this.commit_timer = null;
      this.commit_promise = this.commit_promise
        .then(() => this.flush_commit_queue())
        .catch((error: unknown) => {
          this.commit_error = error;
          this.abort_pipeline(error);
        });
    }, this.commit_interval_ms);
  }

  /**
   * 冲刷提交队列；提交失败交给上层任务 catch 转成 ERROR 终态。
   */
  private async flush_commit_queue(): Promise<void> {
    if (this.commit_queue.length === 0) {
      return;
    }
    const entries = this.commit_queue.splice(0, this.commit_queue.length);
    await this.commit(entries);
  }

  /**
   * 清理定时器，避免任务结束后仍有悬挂提交回调。
   */
  private clear_commit_timer(): void {
    if (this.commit_timer === null) {
      return;
    }
    clearTimeout(this.commit_timer);
    this.commit_timer = null;
  }

  /**
   * 任一 worker 或提交失败时立即关闭入口，并阻止后续 worker 继续取新任务。
   */
  private abort_pipeline(error?: unknown): void {
    if (error !== undefined && this.worker_error === null) {
      this.worker_error = error;
    }
    this.clear_queues();
    if (!this.abort_controller.signal.aborted) {
      this.abort_controller.abort();
    }
  }

  /**
   * 清空所有未执行队列，保证失败后不会启动新的 work unit。
   */
  private clear_queues(): void {
    this.queue.length = 0;
    this.retry_queue.length = 0;
  }

  /**
   * worker 结果必须等全部收束后再提取错误，避免第一处 reject 让 run 提前返回。
   */
  private capture_worker_errors(results: PromiseSettledResult<void>[]): void {
    for (const result of results) {
      if (result.status === "rejected" && this.worker_error === null) {
        this.worker_error = result.reason;
      }
    }
  }

  /**
   * run 结束时移除上游停止监听，避免复用测试对象时残留闭包引用。
   */
  private detach_upstream_abort_listener(): void {
    this.upstream_signal.removeEventListener("abort", this.upstream_abort_listener);
  }

  /**
   * 定时提交发生在 worker 外侧，必须显式回传错误给 run 调用方。
   */
  private throw_commit_error_if_any(): void {
    if (this.commit_error !== null) {
      throw this.commit_error;
    }
  }

  /**
   * worker 错误等 pending 提交处理完成后再抛，让 TaskEngine 统一发布终态。
   */
  private throw_worker_error_if_any(): void {
    if (this.worker_error !== null) {
      throw this.worker_error;
    }
  }
}
