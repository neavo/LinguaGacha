import crypto from "node:crypto";
import type {
  BatchTaskConfig,
  BatchTaskKind,
  BatchTaskProgress,
  BatchTaskRequestState,
  BatchTaskResult,
  BatchTaskSnapshot,
  BatchTaskSnapshotListener,
  BatchTaskStopSource,
} from "../../domain/batch-task";
import type { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
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
  previous: BatchTaskSnapshot; // 受理发布失败时恢复前一轮展示。
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
  private snapshot: BatchTaskSnapshot = {
    revision: 0,
    run_id: null,
    project_path: "",
    kind: null,
    source: null,
    status: "idle",
    stop_source: null,
    config: null,
    progress: null,
    request_in_flight_count: 0,
    request_recovery: null,
  };
  private active_run: ActiveRun | null = null;
  private disposed = false;
  private readonly listeners = new Set<BatchTaskSnapshotListener>();
  private readonly completions = new Set<Promise<BatchTaskResult>>(); // 租约释放回调可同步启动下一批次，关闭仍等待全部完成链。
  private request_state_timer: ReturnType<typeof setTimeout> | null = null;
  private request_state_flush: Promise<void> = Promise.resolve();
  private readonly publication_errors: unknown[] = [];
  private readonly unsubscribe_session: () => void;
  /** 绑定工程切换，确保旧工程的任务展示随会话失效。 */
  public constructor(
    private readonly session: ProjectSessionState,
    private readonly gate: RuntimeOperationGate,
  ) {
    this.unsubscribe_session = session.subscribe_change(async () => {
      if (this.disposed) return;
      if (this.active_run !== null) throw new AppError("runtime.internal_invariant");
      this.snapshot = {
        ...this.snapshot,
        run_id: null,
        project_path: session.snapshot().projectPath,
        kind: null,
        source: null,
        status: "idle",
        stop_source: null,
        config: null,
        progress: null,
        request_in_flight_count: 0,
        request_recovery: null,
      };
      await this.publish_snapshot();
    });
  }
  /** 订阅者的异步工作属于终态发布屏障。 */
  public subscribe(listener: BatchTaskSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** 复制公开快照，隔离订阅者和调用方持有的引用。 */
  public build_snapshot(): BatchTaskSnapshot {
    return structuredClone(this.snapshot);
  }
  /** 独立翻译取得全局租约后预约批次。 */
  public begin_standalone(): BatchTaskRunHandle {
    this.assert_available();
    return this.reserve("standalone", "translation", this.gate.begin_runtime("batch_translation"));
  }
  /** 借用当前 Agent 租约，父回合保留释放责任。 */
  public begin_under_agent(
    lease: RuntimeLease,
    signal: AbortSignal,
    kind: BatchTaskKind,
  ): BatchTaskRunHandle {
    this.assert_available();
    this.gate.assert_current_runtime(lease, "agent");
    return this.reserve("agent", kind, null, signal);
  }
  /** 预约前检查关闭状态与单批次互斥。 */
  private assert_available(): void {
    if (this.disposed) throw new AppError("runtime.disposed");
    if (this.active_run !== null) throw new AppError("runtime.busy");
  }
  /** 同步登记取消和完成句柄，再异步发布受理快照。 */
  private reserve(
    source: "standalone" | "agent",
    kind: BatchTaskKind,
    lease: RuntimeLease | null,
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
      previous: this.snapshot,
      detach_parent: () => parent?.removeEventListener("abort", abort),
      ready: Promise.resolve(),
      attached: false,
    };
    this.active_run = run;
    this.snapshot = {
      ...this.snapshot,
      run_id: handle.run_id,
      project_path: this.session.snapshot().projectPath,
      kind,
      source,
      status: "requested",
      config: null,
      progress: null,
      stop_source: null,
      request_in_flight_count: 0,
      request_recovery: null,
    };
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) abort();
    this.completions.add(completion);
    void completion.then(
      () => this.completions.delete(completion),
      () => this.completions.delete(completion),
    );
    run.ready = this.publish_snapshot();
    void run.ready.catch(() => undefined); // 原始拒绝由唯一完成链消费。
    return handle;
  }
  /** 按运行身份拒绝旧批次的迟到更新。 */
  public is_current(run_id: string): boolean {
    return this.active_run?.handle.run_id === run_id;
  }
  /** 固定本轮展示配置，后续设置修改不改变已运行任务。 */
  public async publish_config(handle: BatchTaskRunHandle, config: BatchTaskConfig): Promise<void> {
    if (!this.is_current(handle.run_id)) return;
    this.snapshot = { ...this.snapshot, config: { ...config } };
    await this.publish_snapshot();
  }
  /** 只发布已结算计数，并将发布失败并入完成链。 */
  public async publish_progress(
    handle: BatchTaskRunHandle,
    progress: BatchTaskProgress,
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) return;
    if (
      progress.total < 0 ||
      progress.succeeded < 0 ||
      progress.failed < 0 ||
      progress.succeeded + progress.failed > progress.total
    )
      throw new AppError("runtime.internal_invariant");
    this.clear_request_state_timer();
    this.snapshot = { ...this.snapshot, progress: { ...progress } };
    try {
      await this.publish_snapshot();
    } catch (error) {
      this.publication_errors.push(error);
      throw error;
    }
  }
  /** 取消优先于运行状态，停止请求的发布错误同样进入完成链。 */
  public async publish_status(
    handle: BatchTaskRunHandle,
    status: "running" | "stopping",
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) return;
    this.snapshot = { ...this.snapshot, status: handle.signal.aborted ? "stopping" : status };
    try {
      await this.publish_snapshot();
    } catch (error) {
      this.publication_errors.push(error);
      throw error;
    }
  }
  /** 确认时固定的运行身份只允许停止对应批次。 */
  public async request_stop(run_id: string): Promise<boolean> {
    const run = this.active_run;
    if (!run || run.handle.run_id !== run_id || !this.cancel_run(run, "user")) return false;
    await this.publish_status(run.handle, "stopping");
    return true;
  }
  /** 首次取消决定来源。所有取消入口都尊重已结算的终态。 */
  private cancel_run(run: ActiveRun, source: BatchTaskStopSource): boolean {
    if (
      !this.is_current(run.handle.run_id) ||
      run.stop_source !== undefined ||
      !["requested", "running", "stopping"].includes(this.snapshot.status)
    )
      return false;
    run.stop_source = source;
    this.snapshot = { ...this.snapshot, stop_source: source, request_recovery: null };
    run.controller.abort();
    return true;
  }
  /** 接管预约，实际执行与收尾由同一个 completion 承接。 */
  public async execute(
    handle: BatchTaskRunHandle,
    runner: () => Promise<"done" | "stopped" | "error">,
    finalize?: (result: BatchTaskResult) => Promise<void>,
  ): Promise<void> {
    const run = this.active_run;
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
    const errors: unknown[] = [];
    let started = false;
    let status: BatchTaskResult["status"] = "error";
    let progress: BatchTaskProgress | null = null; // 释放租约可能同步启动下一批次，回执先固定本轮事实。
    try {
      await run.ready;
      started = true;
      status = await runner();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.request_state_timer !== null) {
        this.clear_request_state_timer();
        try {
          await this.publish_snapshot();
        } catch (error) {
          errors.push(error);
        }
      }
      await this.request_state_flush;
      errors.push(...this.publication_errors.splice(0));
      if (!started) this.snapshot = { ...run.previous, revision: this.snapshot.revision };
      else {
        status =
          errors.length > 0 || status === "error"
            ? "error"
            : run.stop_source === undefined
              ? status
              : "stopped";
        const current_progress = this.snapshot.progress;
        this.snapshot = {
          ...this.snapshot,
          status,
          stop_source: run.stop_source ?? null,
          progress:
            current_progress === null
              ? null
              : {
                  ...current_progress,
                  time: Math.max(0, Date.now() / 1000 - current_progress.start_time),
                },
          request_in_flight_count: 0,
          request_recovery: null,
        };
      }
      progress = this.snapshot.progress;
      try {
        if (finalize !== undefined)
          await finalize({
            run_id: run.handle.run_id,
            status,
            ...(run.stop_source === undefined ? {} : { stop_source: run.stop_source }),
            progress,
          });
      } catch (error) {
        errors.push(error);
        this.snapshot = { ...this.snapshot, status: "error" };
      }
      await this.publish_snapshot();
    } catch (error) {
      errors.push(error);
    } finally {
      this.active_run = null;
      run.detach_parent();
      try {
        if (run.lease !== null) this.gate.finish_runtime(run.lease);
      } catch (error) {
        errors.push(error);
      }
    }
    const result: BatchTaskResult = Object.freeze({
      run_id: run.handle.run_id,
      status: errors.length > 0 ? "error" : status,
      ...(run.stop_source === undefined ? {} : { stop_source: run.stop_source }),
      progress,
    });
    if (errors.length > 0) {
      if (started && this.snapshot.run_id === run.handle.run_id)
        this.snapshot = { ...this.snapshot, status: "error" };
      const cause =
        errors.length === 1
          ? errors[0]
          : new AggregateError(errors, "Batch task completion failed.", { cause: errors[0] });
      run.reject(
        started || run.stop_source !== undefined
          ? new BatchTaskCompletionError(result, cause)
          : cause,
      );
    } else run.resolve(result);
  }
  /** 请求状态按窗口合并，取消后清空恢复提示。 */
  public update_request_state(handle: BatchTaskRunHandle, state: BatchTaskRequestState): void {
    if (!this.is_current(handle.run_id)) return;
    this.snapshot = {
      ...this.snapshot,
      ...state,
      request_recovery:
        handle.signal.aborted || state.request_recovery === null
          ? null
          : { ...state.request_recovery },
    };
    if (this.request_state_timer !== null) return;
    this.request_state_timer = setTimeout(() => {
      this.request_state_timer = null;
      this.request_state_flush = this.request_state_flush
        .then(async () => {
          if (this.is_current(handle.run_id)) await this.publish_snapshot();
        })
        .catch((error) => {
          this.publication_errors.push(error);
        });
    }, BATCH_TASK_REQUEST_STATE_PUBLISH_INTERVAL_MS);
  }
  /** 撤下定时发布，收尾路径负责冲刷最后一次状态。 */
  private clear_request_state_timer(): void {
    if (this.request_state_timer !== null) clearTimeout(this.request_state_timer);
    this.request_state_timer = null;
  }
  /** 推进修订并等待所有订阅者，保留各自的发布异常。 */
  private async publish_snapshot(): Promise<void> {
    this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1 };
    const snapshot = this.build_snapshot();
    const results = await Promise.allSettled(
      [...this.listeners].map(async (listener) => {
        await listener(snapshot);
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
  /** 停止受理，取消当前批次并等待已登记的完成链。 */
  public async dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribe_session();
    const run = this.active_run;
    if (run !== null) {
      this.cancel_run(run, "shutdown");
      if (!run.attached) {
        run.attached = true;
        void this.complete_run(run, async () => "stopped");
      }
    }
    await Promise.allSettled(this.completions);
    this.clear_request_state_timer();
    this.listeners.clear();
  }
}
