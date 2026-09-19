import type {
  TranslationContext,
  TranslationCommitEntry,
} from "../planning/translation-plan-types";
import type { TranslationPipelineWorkerResult } from "./batch-translation-runner-options";
import type { TranslationDispatchState } from "./translation-request-scheduler";

export const TASK_PIPELINE_COMMIT_INTERVAL_MS = 500; // worker 结果提交窗口固定为每秒 2 次，避免高频写库

interface TranslationPipelineOptions {
  read_dispatch_state: () => TranslationDispatchState;
  signal: AbortSignal;
  execute: (
    context: TranslationContext,
    signal: AbortSignal,
  ) => Promise<TranslationPipelineWorkerResult>;
  commit: (entries: TranslationCommitEntry[]) => Promise<void>;
}

/**
 * 批量翻译流水线，按当前额度供应 work unit，并负责内容重试与批量提交。
 */
export class TranslationPipeline {
  private readonly queue: TranslationContext[] = []; // 保存初次 work unit，停止时会被直接清空

  private readonly retry_queue: TranslationContext[] = []; // 优先级高于普通队列，保证失败拆分能尽快收敛

  private readonly commit_queue: TranslationCommitEntry[] = []; // 聚合 worker 产物，再按固定窗口批量提交

  private readonly read_dispatch_state: () => TranslationDispatchState;
  private readonly upstream_signal: AbortSignal;
  private readonly abort_controller: AbortController;
  private readonly signal: AbortSignal;
  private readonly execute: (
    context: TranslationContext,
    signal: AbortSignal,
  ) => Promise<TranslationPipelineWorkerResult>;
  private readonly commit: (entries: TranslationCommitEntry[]) => Promise<void>;
  private readonly upstream_abort_listener: () => void;
  private commit_timer: ReturnType<typeof setTimeout> | null = null;
  private commit_promise: Promise<void> = Promise.resolve();
  private commit_error: unknown = null; // 定时提交失败单独保留，收尾时禁止再次提交。
  private execution_error: unknown = null; // 首次执行失败在活动任务和已有提交收束后抛出。

  /** 将上游取消传入执行链，额度始终从请求调度器读取。 */
  public constructor(options: TranslationPipelineOptions) {
    this.read_dispatch_state = options.read_dispatch_state;
    this.upstream_signal = options.signal;
    this.abort_controller = new AbortController();
    this.signal = this.abort_controller.signal;
    this.execute = options.execute;
    this.commit = options.commit;
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
   * 按额度供应任务，等待全部活动任务收束后冲刷最后一批提交。
   */
  public async run(initial_contexts: TranslationContext[]): Promise<void> {
    this.queue.push(...initial_contexts);
    const active = new Set<Promise<void>>();
    try {
      for (;;) {
        while (!this.signal.aborted) {
          const dispatch = this.read_dispatch_state();
          // 耗尽只关闭供给，活动任务继续交付有效结果与用量。
          if (dispatch.keys_exhausted) {
            this.queue.length = 0;
            this.retry_queue.length = 0;
            break;
          }
          if (active.size >= dispatch.concurrency_limit) break;
          const context = this.retry_queue.shift() ?? this.queue.shift(); // 内容重试优先。
          if (context === undefined) break;
          const task = this.run_context(context).finally(() => active.delete(task));
          active.add(task);
        }
        if (active.size === 0) break;
        // 请求成功先更新额度，再返回 work unit；完成后读取即可，无需另建通知链。
        await Promise.race(active);
      }
      if (this.commit_timer !== null) clearTimeout(this.commit_timer);
      this.commit_timer = null;
      await this.commit_promise;
      if (this.commit_error !== null) throw this.commit_error;
      await this.flush_commit_queue();
      if (this.execution_error !== null) throw this.execution_error;
    } finally {
      this.upstream_signal.removeEventListener("abort", this.upstream_abort_listener);
    }
  }

  /**
   * 单个 work unit 完成后先回收结果和重试；失败取消入口并等待其余活动任务收束。
   */
  private async run_context(context: TranslationContext): Promise<void> {
    try {
      const result = await this.execute(context, this.signal);
      if (this.signal.aborted) return;
      if (result.commit_entries.length > 0) {
        this.push_commit_entries(result.commit_entries);
      }
      if (result.retry_contexts.length > 0) {
        this.retry_queue.push(...result.retry_contexts);
      }
    } catch (error) {
      this.abort_pipeline(error);
    }
  }

  /**
   * work unit 结果进入提交队列后启动 500ms 聚合窗口
   */
  private push_commit_entries(entries: TranslationCommitEntry[]): void {
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
    }, TASK_PIPELINE_COMMIT_INTERVAL_MS);
  }

  /**
   * 冲刷提交队列；提交失败交给上层任务 catch 转成 ERROR 终态
   */
  private async flush_commit_queue(): Promise<void> {
    if (this.commit_queue.length === 0) {
      return;
    }
    const entries = this.commit_queue.splice(0, this.commit_queue.length);
    await this.commit(entries);
  }

  /**
   * 执行或提交失败时立即关闭入口，活动任务沿取消信号自然收束。
   */
  private abort_pipeline(error?: unknown): void {
    if (error !== undefined && this.execution_error === null) {
      this.execution_error = error;
    }
    this.queue.length = 0;
    this.retry_queue.length = 0;
    if (!this.abort_controller.signal.aborted) {
      this.abort_controller.abort();
    }
  }
}
