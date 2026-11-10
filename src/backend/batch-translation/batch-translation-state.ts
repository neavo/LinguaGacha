import {
  normalize_batch_translation_progress,
  type BatchTranslationOperation,
  type BatchTranslationProgress,
  type BatchTranslationResult,
  type BatchTranslationRunProgress,
  type BatchTranslationSnapshot,
} from "../../domain/batch-translation";
import {
  empty_batch_task_progress,
  type BatchTaskConfig,
  type BatchTaskProgress,
  type BatchTaskRequestState,
  type BatchTaskResult,
  type BatchTaskSnapshot,
} from "../../domain/batch-task";
import {
  BatchTaskRuntime,
  BatchTaskCompletionError,
  type BatchTaskRunHandle,
} from "../batch-task/batch-task-runtime";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeLease } from "../runtime-operation-gate";
import { AppError } from "../../shared/error";

export type BatchTranslationRunHandle = Readonly<{
  run_id: string;
  signal: AbortSignal;
  completion: Promise<BatchTranslationResult>;
}>;
/** 翻译回执保留工程累计事实，批次完成链由共享运行态拥有。 */
export class BatchTranslationCompletionError extends Error {
  /** 保留翻译结果和导致失败的原始异常。 */
  public constructor(
    public readonly result: BatchTranslationResult,
    cause: unknown,
  ) {
    super("Batch translation failed.", { cause });
    this.name = "BatchTranslationCompletionError";
  }
}
type TranslationRun = { core: BatchTaskRunHandle; progress: BatchTranslationProgress };
/** 翻译业务投影：目标、语言和工程累计事实，不拥有状态机或取消控制器。 */
export class BatchTranslationState {
  private facts: {
    run_id: string;
    operation: BatchTranslationOperation;
    pending_item_ids: number[];
  } | null = null;
  private readonly runs = new WeakMap<BatchTranslationRunHandle, TranslationRun>(); // 旧句柄只引用自己的累计结果，不能读取下一轮记录。
  /** 组合工程事实与共享任务拥有者。 */
  public constructor(
    private readonly session_state: ProjectSessionState,
    private readonly database: ProjectDatabase,
    private readonly tasks: BatchTaskRuntime,
  ) {}
  /** 累计统计读取已提交的工程元数据。 */
  public async read_progress(): Promise<BatchTranslationProgress> {
    const state = this.session_state.snapshot();
    return normalize_batch_translation_progress(
      state.loaded && state.projectPath !== ""
        ? (await this.database.get_all_meta(state.projectPath))["translation_extras"]
        : {},
    );
  }
  /** 把当前翻译批次计数投影为翻译业务字段。 */
  public read_run_progress(): BatchTranslationRunProgress | undefined {
    const task = this.tasks.build_snapshot();
    return task.kind === "translation" && task.progress !== null
      ? translation_progress(task.progress)
      : undefined;
  }
  /** 公开快照直接读取共享任务拥有者。 */
  public task_snapshot(): BatchTaskSnapshot {
    return this.tasks.build_snapshot();
  }
  /** 固定任务版本后补读工程累计统计。 */
  public build_snapshot(): Promise<BatchTranslationSnapshot> {
    return this.translation_snapshot(this.tasks.build_snapshot());
  }
  /** 先固定目标和运行计数，避免异步读取混入下一版本。 */
  private async translation_snapshot(task: BatchTaskSnapshot): Promise<BatchTranslationSnapshot> {
    const facts =
      task.kind === "translation" && task.run_id === this.facts?.run_id ? this.facts : null;
    const active = ["requested", "running", "stopping"].includes(task.status);
    const snapshot = {
      run_id: facts?.run_id,
      revision: task.revision,
      status: task.kind === "request" ? ("idle" as const) : task.status,
      source: task.kind === "request" ? null : task.source,
      operation: facts?.operation,
      run_progress:
        task.kind === "translation" && task.progress !== null
          ? translation_progress(task.progress)
          : undefined,
      stop_source: task.stop_source ?? undefined,
      pending_item_ids: active && facts !== null ? [...facts.pending_item_ids] : [],
      request_in_flight_count: task.kind === "translation" ? task.request_in_flight_count : 0,
      request_recovery: task.kind === "translation" ? task.request_recovery : null,
    };
    return { ...snapshot, progress: await this.read_progress() };
  }
  /** 预约独立批次并记录本轮翻译目的。 */
  public begin_standalone(
    operation: BatchTranslationOperation = "translate",
  ): BatchTranslationRunHandle {
    return this.bind(this.tasks.begin_standalone(), operation);
  }
  /** 预约 Agent 子任务并记录本轮翻译目的。 */
  public begin_under_agent(
    lease: RuntimeLease,
    signal: AbortSignal,
    operation: BatchTranslationOperation = "translate",
  ): BatchTranslationRunHandle {
    return this.bind(this.tasks.begin_under_agent(lease, signal, "translation"), operation);
  }
  /** 把工程累计结果绑定到共享完成链，保留错误中的停止来源。 */
  private bind(
    core: BatchTaskRunHandle,
    operation: BatchTranslationOperation,
  ): BatchTranslationRunHandle {
    this.facts = { run_id: core.run_id, operation, pending_item_ids: [] };
    const run: TranslationRun = { core, progress: normalize_batch_translation_progress({}) };
    const result = (task: BatchTaskResult): BatchTranslationResult => ({
      status: task.status,
      ...(task.stop_source === undefined ? {} : { stop_source: task.stop_source }),
      progress: { ...run.progress },
      ...(task.progress === null ? {} : { run_progress: translation_progress(task.progress) }),
    });
    const completion = core.completion.then(result, (error: unknown) => {
      if (error instanceof BatchTaskCompletionError)
        throw new BatchTranslationCompletionError(result(error.result), error.cause);
      throw error;
    });
    void completion.catch(() => undefined); // 使用者可以在受理后才等待，原始错误仍保留在 completion。
    const handle = Object.freeze({ run_id: core.run_id, signal: core.signal, completion });
    this.runs.set(handle, run);
    return handle;
  }
  /** 通过句柄身份取回本轮业务记录。 */
  private run(handle: BatchTranslationRunHandle): TranslationRun {
    const run = this.runs.get(handle);
    if (!run) throw new AppError("runtime.internal_invariant");
    return run;
  }
  /** 执行翻译并在出错时补读已提交成果。 */
  public async execute(
    handle: BatchTranslationRunHandle,
    runner: () => Promise<BatchTranslationResult>,
  ): Promise<void> {
    const run = this.run(handle);
    try {
      await this.tasks.execute(run.core, async () => {
        try {
          const output = await runner();
          run.progress = { ...output.progress };
          if (output.run_progress !== undefined)
            await this.tasks.publish_progress(run.core, task_progress(output.run_progress));
          return output.status;
        } catch (error) {
          try {
            run.progress = await this.read_progress();
          } catch (read_error) {
            throw new AggregateError([error, read_error], "Translation completion failed.", {
              cause: error,
            });
          }
          throw error;
        }
      });
    } catch {
      await handle.completion;
    }
  }
  /** 翻译提交沿用共享运行身份校验。 */
  public is_current(run_id: string): boolean {
    return this.tasks.is_current(run_id);
  }
  /** 模型摘要只由共享运行态持有，翻译语言留在执行上下文。 */
  public publish_config(handle: BatchTranslationRunHandle, config: BatchTaskConfig): Promise<void> {
    return this.tasks.publish_config(this.run(handle).core, config);
  }
  /** 翻译流程通过共享状态机推进阶段。 */
  public publish_status(
    handle: BatchTranslationRunHandle,
    status: "running" | "stopping",
  ): Promise<void> {
    return this.tasks.publish_status(this.run(handle).core, status);
  }
  /** 冻结目标集合，并同步确定本轮分母。 */
  public async publish_targets(
    handle: BatchTranslationRunHandle,
    target_ids: ReadonlySet<number>,
  ): Promise<BatchTranslationRunProgress> {
    const progress = empty_batch_task_progress("item", target_ids.size);
    if (this.is_current(handle.run_id) && this.facts !== null) {
      this.facts.pending_item_ids = [...target_ids];
      await this.tasks.publish_progress(this.run(handle).core, progress);
    }
    return translation_progress(progress);
  }
  /** 成功与耗尽的条目一起退出待处理范围。 */
  public async publish_progress(
    handle: BatchTranslationRunHandle,
    settled_ids: number[] = [],
    progress?: BatchTranslationRunProgress,
  ): Promise<void> {
    if (!this.is_current(handle.run_id) || this.facts === null) return;
    const done = new Set(settled_ids);
    this.facts.pending_item_ids = this.facts.pending_item_ids.filter((id) => !done.has(id));
    const next = progress ?? this.read_run_progress();
    if (next !== undefined)
      await this.tasks.publish_progress(this.run(handle).core, task_progress(next));
  }
  /** 请求压力与恢复阶段交给共享发布窗口。 */
  public update_request_state(
    handle: BatchTranslationRunHandle,
    state: BatchTaskRequestState,
  ): void {
    this.tasks.update_request_state(this.run(handle).core, state);
  }
  /** 沿共享完成链等待翻译和通用请求收尾。 */
  public dispose(): Promise<void> {
    return this.tasks.dispose();
  }
}
/** 翻译持久化字段在业务边界转换，公共运行态只接受本轮计数。 */
function task_progress(progress: BatchTranslationRunProgress): BatchTaskProgress {
  return {
    unit: "item",
    total: progress.total_line,
    succeeded: progress.processed_line,
    failed: progress.failed_line,
    start_time: progress.start_time,
    time: progress.time,
    input_tokens: progress.total_input_tokens,
    reasoning_tokens: progress.total_reasoning_tokens,
    output_tokens: progress.total_output_tokens,
    usage_complete: false, // 翻译提交统计未保存原始回执完整性，只能报告已知用量。
  };
}
/** 翻译调用方沿用原有统计词表，转换不改变工程累计事实。 */
function translation_progress(progress: BatchTaskProgress): BatchTranslationRunProgress {
  return {
    total_line: progress.total,
    processed_line: progress.succeeded,
    failed_line: progress.failed,
    start_time: progress.start_time,
    time: progress.time,
    total_input_tokens: progress.input_tokens,
    total_reasoning_tokens: progress.reasoning_tokens,
    total_output_tokens: progress.output_tokens,
    total_tokens: progress.input_tokens + progress.reasoning_tokens + progress.output_tokens,
  };
}
