import crypto from "node:crypto";
import { create_batch_task_snapshot, EMPTY_BATCH_TASK_USAGE } from "../../domain/batch-task";
import type { BatchTranslationOperation } from "../../domain/batch-translation";
import type {
  BatchTranslationCompletion,
  BatchTaskActivity,
  BatchTaskEndpoint,
  BatchTaskUsage,
  BatchTaskKind,
  BatchTaskListSnapshot,
  BatchTaskProgress,
  BatchTaskRequestState,
  BatchTaskResult,
  BatchTaskSnapshot,
  BatchTaskSnapshotListener,
  BatchTaskStopSource,
} from "../../domain/batch-task";
import type { RuntimeLease, ProjectOperationGate } from "../runtime-operation-gate";
import { AppError } from "../../shared/error";

export const BATCH_TASK_REQUEST_STATE_PUBLISH_INTERVAL_MS = 500;
export type BatchTaskRunHandle = Readonly<{
  run_id: string;
  signal: AbortSignal;
  completion: Promise<BatchTaskResult>;
}>;
type ActiveRun = {
  handle: BatchTaskRunHandle;
  controller: AbortController;
  lease: RuntimeLease | null;
  detach_parent: () => void;
  snapshot: BatchTaskSnapshot;
  finishing: boolean;
  request_state_timer: ReturnType<typeof setTimeout> | undefined;
  request_state_flush: Promise<void>;
  errors: Set<unknown>; // 同一发布错误也可能沿 runner 抛出。
  ready: Promise<void>; // 首次发布完成后才允许执行请求。
  attached: boolean; // 关闭时接管尚未交给 runner 的预约。
  stop_source?: BatchTaskStopSource;
  resolve: (result: BatchTaskResult) => void;
  reject: (error: unknown) => void;
};
/** 失败保留已结算事实与首次停止来源。 */
export class BatchTaskCompletionError extends Error {
  /** 将终态统计与导致失败的原始异常绑定。 */
  public constructor(
    public readonly result: BatchTaskResult,
    cause: unknown,
  ) {
    super("Batch task failed.", { cause });
    this.name = "BatchTaskCompletionError";
  }
}
/** 只拥有批次生命周期。业务层负责提交和结果文件收尾。 */
export class BatchTaskRuntime {
  private readonly active_runs = new Map<string, ActiveRun>();
  private activity: BatchTaskActivity | null = null; // 记录先结束的并行批次用量，活跃批次在构造快照时合计。
  private last_translation: BatchTranslationCompletion | null = null;
  private revision = 0;
  private disposed = false;
  private readonly listeners = new Set<BatchTaskSnapshotListener>();
  private readonly completions = new Set<Promise<BatchTaskResult>>(); // 租约释放回调可同步启动下一批次，关闭仍等待全部完成链。
  /** 一个打开周期共用同一工程门禁和快照版本。 */
  public constructor(
    private readonly project_path: string,
    private readonly gate: ProjectOperationGate,
  ) {}
  /** 订阅者的异步工作属于终态发布屏障。 */
  public subscribe(listener: BatchTaskSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** 复制公开快照，隔离订阅者和调用方持有的引用。 */
  public build_snapshot(): BatchTaskListSnapshot {
    return structuredClone(this.read_snapshot());
  }

  /** 活跃批次贡献当前用量，已收尾批次的用量保留到本轮结束。 */
  private read_snapshot(): BatchTaskListSnapshot {
    const tasks = [...this.active_runs.values()].map((run) => run.snapshot);
    const activity = this.activity;
    return {
      revision: this.revision,
      project_path: this.project_path,
      activity:
        activity === null
          ? null
          : {
              ...activity,
              usage: tasks.reduce((usage, task) => add_usage(usage, task.progress), activity.usage),
            },
      tasks,
      last_translation: this.last_translation,
    };
  }

  /** 独立翻译取得工程翻译租约后预约批次。 */
  public begin_standalone(operation: BatchTranslationOperation = "translate"): BatchTaskRunHandle {
    this.assert_available();
    return this.reserve(
      "standalone",
      "translation",
      this.gate.begin_runtime("batch_translation"),
      operation,
    );
  }
  /** Agent 翻译与独立翻译争用同一工程租约，通用请求沿用父 Agent 租约。 */
  public begin_under_agent(
    lease: RuntimeLease,
    signal: AbortSignal,
    kind: BatchTaskKind,
    operation: BatchTranslationOperation = "translate",
  ): BatchTaskRunHandle {
    this.assert_available();
    this.gate.assert_agent_runtime(lease);
    const translation =
      kind === "translation" ? this.gate.begin_runtime("batch_translation") : null;
    return this.reserve(
      "agent",
      kind,
      translation,
      kind === "translation" ? operation : undefined,
      signal,
    );
  }
  /** 预约前检查关闭状态。 */
  private assert_available(): void {
    if (this.disposed) throw new AppError("runtime.disposed");
  }
  /** 同步登记取消和完成句柄，再异步发布受理快照。 */
  private reserve(
    source: "standalone" | "agent",
    kind: BatchTaskKind,
    lease: RuntimeLease | null,
    operation: BatchTranslationOperation | undefined,
    parent?: AbortSignal,
  ): BatchTaskRunHandle {
    const controller = new AbortController();
    let resolve!: ActiveRun["resolve"];
    let reject!: ActiveRun["reject"];
    const completion = new Promise<BatchTaskResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const handle = Object.freeze({
      run_id: crypto.randomUUID(),
      signal: controller.signal,
      completion,
    });
    const abort = () => this.cancel_run(run, "parent");
    const run: ActiveRun = {
      handle,
      controller,
      lease,
      resolve,
      reject,
      snapshot: {
        ...create_batch_task_snapshot(handle.run_id, kind, source),
        ...(operation === undefined ? {} : { translation: { operation, pending_item_ids: [] } }),
      },
      finishing: false,
      request_state_timer: undefined,
      request_state_flush: Promise.resolve(),
      errors: new Set(),
      detach_parent: () => parent?.removeEventListener("abort", abort),
      ready: Promise.resolve(),
      attached: false,
    };
    this.activity ??= {
      id: handle.run_id,
      start_time: Date.now() / 1000,
      usage: EMPTY_BATCH_TASK_USAGE,
    };
    this.active_runs.set(handle.run_id, run);
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) abort();
    this.completions.add(completion);
    void completion.then(
      () => this.completions.delete(completion),
      () => this.completions.delete(completion),
    );
    run.ready = this.publish_snapshot([run]);
    void run.ready.catch(() => undefined); // 原始拒绝由唯一完成链消费。
    return handle;
  }
  /** 只发布已结算计数，并将发布失败并入完成链。 */
  public async publish_progress(
    handle: BatchTaskRunHandle,
    progress: BatchTaskProgress,
    pending_item_ids?: readonly number[],
  ): Promise<void> {
    const run = this.active_runs.get(handle.run_id);
    if (run === undefined || run.finishing) return;
    if (
      progress.total < 0 ||
      progress.succeeded < 0 ||
      progress.failed < 0 ||
      progress.succeeded + progress.failed > progress.total
    )
      throw new AppError("runtime.internal_invariant");
    this.clear_request_state_timer(run);
    run.snapshot = {
      ...run.snapshot,
      progress: { ...progress },
      ...(run.snapshot.translation !== undefined && pending_item_ids !== undefined
        ? { translation: { ...run.snapshot.translation, pending_item_ids: [...pending_item_ids] } }
        : {}),
    };
    await this.publish_runs([run]);
  }
  /** 尊重准备期间收到的停止请求。 */
  public async publish_running(handle: BatchTaskRunHandle): Promise<void> {
    const run = this.active_runs.get(handle.run_id);
    if (run === undefined || run.finishing) return;
    run.snapshot = {
      ...run.snapshot,
      status: handle.signal.aborted ? "stopping" : "running",
    };
    await this.publish_runs([run]);
  }
  /** 一次受理确认时锁定的批次，随后发布同一份停止快照。 */
  public async request_stop(run_ids: readonly string[]): Promise<boolean> {
    const stopped: ActiveRun[] = [];
    for (const run_id of run_ids) {
      const run = this.active_runs.get(run_id);
      if (run && this.cancel_run(run, "user")) stopped.push(run);
    }
    if (stopped.length === 0) return false;
    await this.publish_runs(stopped);
    return true;
  }
  /** 首次取消决定来源。所有取消入口都尊重已结算的终态。 */
  private cancel_run(run: ActiveRun, source: BatchTaskStopSource): boolean {
    if (run.stop_source !== undefined || run.finishing) return false;
    run.stop_source = source;
    run.snapshot = {
      ...run.snapshot,
      status: "stopping",
      stop_source: source,
      request_recovery: null,
    };
    run.controller.abort();
    return true;
  }
  /** 接管预约，实际执行与收尾由同一个 completion 承接。 */
  public async execute(
    handle: BatchTaskRunHandle,
    runner: () => Promise<"done" | "stopped" | "error">,
    finalize?: (result: BatchTaskResult) => Promise<void>,
  ): Promise<void> {
    const run = this.active_runs.get(handle.run_id);
    if (run?.handle !== handle || run.attached) throw new AppError("runtime.internal_invariant");
    run.attached = true;
    void this.complete_run(run, runner, finalize);
    try {
      await run.ready;
    } catch {
      await handle.completion;
    }
  }
  /** 等待请求、结果发布与订阅者收尾，再释放自有租约。 */
  private async complete_run(
    run: ActiveRun,
    runner: () => Promise<"done" | "stopped" | "error">,
    finalize?: (result: BatchTaskResult) => Promise<void>,
  ): Promise<void> {
    const errors = run.errors;
    let started = false;
    let status: BatchTaskResult["status"] = "error";
    let progress: BatchTaskProgress | null = null; // 释放租约可能同步启动下一批次，回执先固定本轮事实。
    try {
      await run.ready;
      started = true;
      status = await runner();
    } catch (error) {
      errors.add(error);
    }
    try {
      // 终态会清空请求压力，只等待已经开始的发布。
      this.clear_request_state_timer(run);
      await run.request_state_flush;
      run.finishing = true;
      if (started) {
        status =
          errors.size > 0 || status === "error"
            ? "error"
            : run.stop_source === undefined
              ? status
              : "stopped";
        progress = run.snapshot.progress;
        if (progress !== null)
          progress = { ...progress, time: Math.max(0, Date.now() / 1000 - progress.start_time) };
        try {
          if (finalize !== undefined)
            await finalize({
              run_id: run.handle.run_id,
              status,
              ...(run.stop_source === undefined ? {} : { stop_source: run.stop_source }),
              progress,
            });
        } catch (error) {
          errors.add(error);
          status = "error";
        }
        run.snapshot = {
          ...run.snapshot,
          status,
          stop_source: run.stop_source ?? null,
          progress,
          request_in_flight_count: 0,
          request_recovery: null,
          ...(run.snapshot.translation === undefined
            ? {}
            : {
                translation: { ...run.snapshot.translation, pending_item_ids: [] },
              }),
        };
        this.remember_translation(run, status);
      }
      this.remove_run(run);
      await this.publish_snapshot([run]);
    } catch (error) {
      errors.add(error);
    } finally {
      this.remove_run(run);
      run.detach_parent();
      try {
        if (run.lease !== null) this.gate.finish_runtime(run.lease);
      } catch (error) {
        errors.add(error);
      }
    }
    const result: BatchTaskResult = Object.freeze({
      run_id: run.handle.run_id,
      status: errors.size > 0 ? "error" : status,
      ...(run.stop_source === undefined ? {} : { stop_source: run.stop_source }),
      progress,
    });
    if (errors.size > 0) {
      if (started) {
        run.snapshot = { ...run.snapshot, status: "error" };
        if (this.last_translation?.run_id === run.handle.run_id) {
          this.remember_translation(run, "error");
          this.revision += 1; // 补读终态时能接收修正后的回执。
        }
      }
      const first = errors.values().next().value;
      const cause =
        errors.size === 1
          ? first
          : new AggregateError(errors, "Batch task completion failed.", { cause: first });
      run.reject(
        started || run.stop_source !== undefined
          ? new BatchTaskCompletionError(result, cause)
          : cause,
      );
    } else run.resolve(result);
  }
  /** 批次离开后，其已结算用量继续计入尚未完成的本轮。 */
  private remove_run(run: ActiveRun): void {
    const activity = this.activity;
    if (!this.active_runs.delete(run.handle.run_id) || activity === null) return;
    this.activity =
      this.active_runs.size === 0
        ? null
        : {
            ...activity,
            usage: add_usage(activity.usage, run.snapshot.progress),
          };
  }

  /** 独立翻译回执供当前工程会话交接通知与导出。 */
  private remember_translation(run: ActiveRun, status: BatchTaskResult["status"]): void {
    const { translation, source, run_id, progress } = run.snapshot;
    if (source === "standalone" && translation !== undefined) {
      this.last_translation = {
        run_id,
        operation: translation.operation,
        status,
        failed: progress?.failed ?? 0,
      };
    }
  }
  /** 本轮实际请求首次出现或发生变化时，经同一请求状态窗口发布接入点。 */
  public update_endpoint(handle: BatchTaskRunHandle, endpoint: BatchTaskEndpoint): void {
    const run = this.active_runs.get(handle.run_id);
    if (run === undefined || run.finishing) return;
    const previous = run.snapshot.endpoint;
    if (
      previous?.id === endpoint.id &&
      previous.model_id === endpoint.model_id &&
      previous.thinking_level === endpoint.thinking_level
    )
      return;
    run.snapshot = { ...run.snapshot, endpoint: { ...endpoint } };
    this.schedule_request_snapshot(run);
  }

  /** 请求状态按窗口合并，取消后清空恢复提示。 */
  public update_request_state(handle: BatchTaskRunHandle, state: BatchTaskRequestState): void {
    const run = this.active_runs.get(handle.run_id);
    if (run === undefined || run.finishing) return;
    run.snapshot = {
      ...run.snapshot,
      ...state,
      request_recovery:
        handle.signal.aborted || state.request_recovery === null
          ? null
          : { ...state.request_recovery },
    };
    this.schedule_request_snapshot(run);
  }

  /** 一个窗口内只保留最新的请求压力和接入点。 */
  private schedule_request_snapshot(run: ActiveRun): void {
    if (run.request_state_timer !== undefined) return;
    run.request_state_timer = setTimeout(() => {
      run.request_state_timer = undefined;
      run.request_state_flush = run.request_state_flush
        .then(() => this.publish_runs([run]))
        .catch(() => undefined); // publish_runs 已把原错误交给完成链。
    }, BATCH_TASK_REQUEST_STATE_PUBLISH_INTERVAL_MS);
  }
  /** 进度发布或批次收尾已覆盖待发的请求压力。 */
  private clear_request_state_timer(run: ActiveRun): void {
    if (run.request_state_timer !== undefined) clearTimeout(run.request_state_timer);
    run.request_state_timer = undefined;
  }
  /** 停止和定时发布可能脱离 runner 调用栈，失败统一汇入批次完成链。 */
  private async publish_runs(runs: readonly ActiveRun[]): Promise<void> {
    try {
      await this.publish_snapshot(runs);
    } catch (error) {
      for (const run of runs) run.errors.add(error);
      throw error;
    }
  }
  /** 推进修订并等待所有订阅者，保留各自的发布异常。 */
  private async publish_snapshot(runs: readonly ActiveRun[]): Promise<void> {
    this.revision += 1;
    const { snapshot, changes } = structuredClone({
      snapshot: this.read_snapshot(),
      changes: runs.map((run) => run.snapshot), // 终态已离开活跃列表，CLI 仍需读取最后一帧。
    });
    // 受理方先取得句柄，订阅者随后观察状态。
    await Promise.resolve();
    const results = await Promise.allSettled(
      [...this.listeners].map(async (listener) => {
        await listener(snapshot, changes);
      }),
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0)
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Batch task snapshot publication failed.");
  }
  /** 停止受理，取消所有活跃批次并等待已登记的完成链。 */
  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const run of this.active_runs.values()) {
      this.cancel_run(run, "shutdown");
      if (!run.attached) {
        run.attached = true;
        void this.complete_run(run, async () => "stopped");
      }
    }
    await Promise.allSettled(this.completions);
    this.listeners.clear();
  }
}

/** 准备阶段尚无已结算用量。 */
function add_usage(total: BatchTaskUsage, usage: BatchTaskUsage | null): BatchTaskUsage {
  if (usage === null) return total;
  return {
    input_tokens: total.input_tokens + usage.input_tokens,
    reasoning_tokens: total.reasoning_tokens + usage.reasoning_tokens,
    output_tokens: total.output_tokens + usage.output_tokens,
  };
}
