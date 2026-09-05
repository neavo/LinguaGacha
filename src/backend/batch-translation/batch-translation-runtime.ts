import crypto from "node:crypto";
import {
  clone_translation_scope,
  normalize_translation_scope,
  normalize_batch_translation_progress,
  type BatchTranslationProgress,
  type BatchTranslationStopSource,
  type BatchTranslationResult,
  type BatchTranslationScope,
  type BatchTranslationSnapshot,
  type BatchTranslationSnapshotListener,
} from "../../domain/batch-translation";
import type { ProjectDataReader } from "../project/project-data-reader";
import type { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
import type { BatchTranslationConfig } from "../../domain/batch-translation";
import { AppError } from "../../shared/error";

/** 停止后的收尾失败同时携带取消事实与原始异常，供调用方落实用户意图。 */
export class BatchTranslationCompletionError extends Error {
  /** 将终态与原始收尾失败绑定到同一完成链。 */
  public constructor(
    public readonly result: BatchTranslationResult,
    cause: unknown,
  ) {
    super("Batch translation completion failed after cancellation.", { cause });
    this.name = "BatchTranslationCompletionError";
  }
}

export const BATCH_TRANSLATION_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS = 500;
export type BatchTranslationRunHandle = Readonly<{
  run_id: string;
  signal: AbortSignal;
  completion: Promise<BatchTranslationResult>;
}>;
type ActiveRun = {
  handle: BatchTranslationRunHandle;
  controller: AbortController;
  lease: RuntimeLease | null;
  detach_parent: () => void;
  previous: BatchTranslationSnapshot;
  ready: Promise<void>;
  attached: boolean;
  stop_source?: BatchTranslationStopSource; // 首次取消决定来源，属于当前 run
  resolve: (result: BatchTranslationResult) => void;
  reject: (error: unknown) => void;
};

/** 活动翻译、父取消和唯一完成链的拥有者；Agent lease 由 Agent round 释放。 */
export class BatchTranslationRuntime {
  private snapshot: BatchTranslationSnapshot = {
    revision: 0,
    status: "idle",
    request_in_flight_count: 0,
    progress: normalize_batch_translation_progress({}),
    scope: { kind: "all" },
  };
  private active_run: ActiveRun | null = null;
  private disposed = false;
  private readonly listeners = new Set<BatchTranslationSnapshotListener>();
  private readonly completions = new Set<Promise<BatchTranslationResult>>();
  private pressure_timer: ReturnType<typeof setTimeout> | null = null;
  private pressure_flush: Promise<void> = Promise.resolve();
  private readonly pressure_errors: unknown[] = [];
  private readonly unsubscribe_session: () => void;

  /** 绑定工程世代切换，清空上一工程的运行展示。 */
  public constructor(
    private readonly session_state: ProjectSessionState,
    private readonly data_reader: ProjectDataReader,
    private readonly runtime_gate: RuntimeOperationGate,
  ) {
    this.unsubscribe_session = session_state.subscribe_change(async () => {
      if (this.disposed) return;
      if (this.active_run !== null) throw new AppError("runtime.internal_invariant");
      this.snapshot = {
        ...this.snapshot,
        status: "idle",
        config: undefined,
        stop_source: undefined,
        scope: { kind: "all" },
        request_in_flight_count: 0,
      };
      await this.publish_snapshot();
    });
  }
  /** 注册快照消费者；返回本次订阅的释放入口。 */
  public subscribe(listener: BatchTranslationSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** 累计进度始终读取当前工程已提交的 meta。 */
  public read_progress(): BatchTranslationProgress {
    const state = this.session_state.snapshot();
    return normalize_batch_translation_progress(
      state.loaded && state.projectPath !== ""
        ? this.data_reader.get_all_meta(state.projectPath)["translation_extras"]
        : {},
    );
  }
  /** 组合运行态与持久进度，并隔离可变 scope。 */
  public async build_snapshot(): Promise<BatchTranslationSnapshot> {
    return {
      ...this.snapshot,
      progress: this.read_progress(),
      ...(this.snapshot.config === undefined ? {} : { config: { ...this.snapshot.config } }),
      scope: clone_translation_scope(this.snapshot.scope),
    };
  }
  /** 独立运行原子取得全局 lease 后预约翻译。 */
  public begin_standalone(scope: BatchTranslationScope): BatchTranslationRunHandle {
    this.assert_available();
    return this.reserve(scope, this.runtime_gate.begin_runtime("batch_translation"));
  }
  /** 复用当前 Agent lease，并连接工具的父取消信号。 */
  public begin_under_agent(
    scope: BatchTranslationScope,
    lease: RuntimeLease,
    signal: AbortSignal,
  ): BatchTranslationRunHandle {
    this.assert_available();
    this.runtime_gate.assert_current_runtime(lease, "agent");
    return this.reserve(scope, null, signal);
  }
  /** 预约前检查关闭状态与单 run 互斥。 */
  private assert_available(): void {
    if (this.disposed) throw new AppError("runtime.disposed");
    if (this.active_run !== null) throw new AppError("runtime.busy");
  }
  /** 同步登记运行句柄和完成链，随后发布受理快照。 */
  private reserve(
    scope: BatchTranslationScope,
    lease: RuntimeLease | null,
    parent?: AbortSignal,
  ): BatchTranslationRunHandle {
    const controller = new AbortController();
    let resolve!: (result: BatchTranslationResult) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<BatchTranslationResult>((res, rej) => {
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
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) abort();
    this.active_run = run;
    this.completions.add(completion);
    // 首次异步发布前登记 completion，dispose 与同步停止均覆盖预约阶段。
    void completion.then(
      () => this.completions.delete(completion),
      () => this.completions.delete(completion),
    );
    this.snapshot = {
      ...this.snapshot,
      status: "requested",
      config: undefined,
      stop_source: run.stop_source,
      scope: normalize_translation_scope(scope),
      request_in_flight_count: 0,
    };
    run.ready = this.publish_snapshot();
    void run.ready.catch(() => undefined); // 原始拒绝由 execute 的完成链消费。
    return handle;
  }
  /** 配置由 Runner 从执行快照投影，并归属于当前 run。 */
  public async publish_config(
    handle: BatchTranslationRunHandle,
    config: BatchTranslationConfig,
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) return;
    this.snapshot = { ...this.snapshot, config: Object.freeze({ ...config }) };
    await this.publish_snapshot();
  }

  /** 同步接管预约；运行结果和收尾始终通过 handle.completion 读取。 */
  public async execute(
    handle: BatchTranslationRunHandle,
    runner: () => Promise<BatchTranslationResult>,
  ): Promise<void> {
    const run = this.active_run;
    if (run?.handle !== handle || run.attached) throw new AppError("runtime.internal_invariant");
    run.attached = true;
    void this.complete_run(run, runner);
    try {
      await run.ready;
    } catch {
      await handle.completion;
    }
  }
  /** 等待执行与快照发布收束，释放自有 lease 后结算唯一 completion。 */
  private async complete_run(
    run: ActiveRun,
    runner: () => Promise<BatchTranslationResult>,
  ): Promise<void> {
    const errors: unknown[] = [];
    let started = false;
    let result: BatchTranslationResult | undefined;
    try {
      await run.ready;
      started = true;
      const output = await runner();
      result = Object.freeze({
        status: output.status,
        progress: Object.freeze({ ...output.progress }),
      });
    } catch (error) {
      errors.push(error);
    }
    try {
      if (this.pressure_timer !== null) {
        this.clear_pressure_timer();
        try {
          await this.publish_snapshot();
        } catch (error) {
          errors.push(error);
        }
      }
      await this.pressure_flush;
      errors.push(...this.pressure_errors.splice(0));
      if (!started) {
        this.snapshot = { ...run.previous, revision: this.snapshot.revision };
        await this.publish_snapshot();
      } else {
        result ??= Object.freeze({
          status: "error",
          progress: Object.freeze(this.read_progress()),
        });
        // 最后一次异步收尾后冻结结果；此刻之前受理的停止都属于本轮。
        result = Object.freeze({
          ...result,
          status:
            result.status === "error"
              ? "error"
              : run.stop_source === undefined
                ? result.status
                : "stopped",
          ...(run.stop_source === undefined ? {} : { stop_source: run.stop_source }),
        });
        this.snapshot = {
          ...this.snapshot,
          status: result.status,
          stop_source: run.stop_source,
          request_in_flight_count: 0,
          scope: { kind: "all" },
          progress: { ...result.progress },
        };
        await this.publish_snapshot(result.progress);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      this.active_run = null;
      run.detach_parent();
      try {
        if (run.lease !== null) this.runtime_gate.finish_runtime(run.lease);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      const cause =
        errors.length === 1
          ? errors[0]
          : new AggregateError(errors, "Batch translation completion failed.");
      run.reject(
        run.stop_source !== undefined
          ? new BatchTranslationCompletionError(
              Object.freeze({
                status: "error",
                stop_source: run.stop_source,
                // 预约尚未执行时沿用前置进度，停止事实仍随完成链返回。
                progress: result?.progress ?? Object.freeze({ ...run.previous.progress }),
              }),
              cause,
            )
          : cause,
      );
    } else if (result !== undefined) run.resolve(result);
    else run.reject(new AppError("runtime.internal_invariant"));
  }
  /** 按 run 身份拦截迟到的提交与进度。 */
  public is_current(run_id: string): boolean {
    return this.active_run?.handle.run_id === run_id;
  }
  /** 取消优先于 running，发布失败进入完成链。 */
  public async publish_status(
    handle: BatchTranslationRunHandle,
    status: "running" | "stopping",
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) return;
    this.snapshot = {
      ...this.snapshot,
      status: handle.signal.aborted ? "stopping" : status,
      stop_source: this.active_run?.stop_source,
    };
    try {
      await this.publish_snapshot();
    } catch (error) {
      this.pressure_errors.push(error);
      throw error;
    }
  }
  /** 只取消仍活跃的 run，终态发布期间保留收尾链。 */
  public async request_stop(): Promise<boolean> {
    const run = this.active_run;
    if (run === null || !["requested", "running", "stopping"].includes(this.snapshot.status))
      return false;
    if (run.stop_source !== undefined) return false;
    this.cancel_run(run, "user");
    await this.publish_status(run.handle, "stopping");
    return true;
  }
  /** 取消来源先于信号冻结，父取消和重复请求共同遵循首次受理语义。 */
  private cancel_run(run: ActiveRun, source: BatchTranslationStopSource): void {
    if (run.stop_source !== undefined) return;
    run.stop_source = source;
    run.controller.abort();
  }
  /** 已提交条目退出重翻范围，并立即发布持久进度。 */
  public async publish_progress(
    handle: BatchTranslationRunHandle,
    committed_ids: number[] = [],
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) return;
    this.clear_pressure_timer();
    if (this.snapshot.scope.kind === "items") {
      const done = new Set(committed_ids);
      this.snapshot = {
        ...this.snapshot,
        scope: {
          kind: "items",
          item_ids: this.snapshot.scope.item_ids.filter((id) => !done.has(id)),
        },
      };
    }
    try {
      await this.publish_snapshot();
    } catch (error) {
      this.pressure_errors.push(error);
      throw error;
    }
  }
  /** 请求计数在内存累积，由单个定时窗口合并发布。 */
  public change_request_in_flight_count(handle: BatchTranslationRunHandle, delta: number): void {
    if (!this.is_current(handle.run_id)) return;
    this.snapshot = {
      ...this.snapshot,
      request_in_flight_count: Math.max(
        0,
        this.snapshot.request_in_flight_count + (Number.isFinite(delta) ? Math.trunc(delta) : 0),
      ),
    };
    if (this.pressure_timer !== null) return;
    this.pressure_timer = setTimeout(() => {
      this.pressure_timer = null;
      this.pressure_flush = this.pressure_flush
        .then(async () => {
          if (this.is_current(handle.run_id)) await this.publish_snapshot();
        })
        .catch((error) => {
          this.pressure_errors.push(error);
        });
    }, BATCH_TRANSLATION_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS);
  }
  /** 撤销待发布窗口，终态收尾负责冲刷计数。 */
  private clear_pressure_timer(): void {
    if (this.pressure_timer !== null) clearTimeout(this.pressure_timer);
    this.pressure_timer = null;
  }
  /** 推进 revision 并等待全部消费者，汇总发布异常。 */
  private async publish_snapshot(progress?: Readonly<BatchTranslationProgress>): Promise<void> {
    this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1 };
    const snapshot =
      progress === undefined
        ? await this.build_snapshot()
        : {
            ...this.snapshot,
            progress: { ...progress },
            scope: clone_translation_scope(this.snapshot.scope),
          };
    const results = await Promise.allSettled(
      [...this.listeners].map(async (listener) => {
        await listener(snapshot);
      }),
    );
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
    if (errors.length > 0)
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "Batch translation snapshot publication failed.");
  }
  /** 关闭受理并取消运行，等待预约与执行共享的完成链。 */
  public async dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribe_session();
    const run = this.active_run;
    if (run !== null) this.cancel_run(run, "shutdown");
    if (run !== null && !run.attached) {
      run.attached = true;
      void this.complete_run(run, async () => ({
        status: "stopped",
        progress: this.read_progress(),
      }));
    }
    await Promise.allSettled(this.completions);
    this.clear_pressure_timer();
    this.listeners.clear();
  }
}
