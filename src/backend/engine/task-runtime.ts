import crypto from "node:crypto";

import type { ProjectDataReader } from "../project/project-data-reader";
import type { ProjectSessionChange, ProjectSessionState } from "../project/project-session-state";
import {
  clone_translation_scope,
  is_task_type,
  normalize_task_progress_snapshot,
  normalize_translation_scope,
  type TaskRunStatus,
  type TaskType,
  type TranslationScope,
} from "../../domain/task";
import {
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type MutableJsonRecord,
} from "../../domain/json";
import * as AppErrors from "../../shared/error";
import type { RuntimeLease, RuntimeOperationGate } from "../runtime-operation-gate";
import type { TaskProgress, TaskSnapshot, TaskSnapshotListener } from "./protocol/task-snapshot";

export const TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS = 500;

type ActiveTaskType = TaskType | "idle";

export type TaskRuntimeStateSnapshot = {
  run_revision: number;
  status: TaskRunStatus;
  request_in_flight_count: number;
  active_task_type: ActiveTaskType;
  translation_scope: TranslationScope;
};

export type TaskRunHandle = {
  run_id: string;
  task_type: TaskType;
  signal: AbortSignal;
};

type ActiveRun = {
  run_id: string;
  task_type: TaskType;
  abort_controller: AbortController;
  runtime_lease: RuntimeLease;
  previous_state: TaskRuntimeStateSnapshot;
  completion: Promise<void> | null; // Engine 接管后绑定，dispose 必须等它释放运行 lease
};

type PendingRequestPressure = {
  run_id: string;
  task_type: TaskType;
};

/**
 * 任务运行态唯一所有者，集中维护任务取消、快照和请求压力节流。
 */
export class TaskRuntime {
  private status: TaskRunStatus = "idle";

  private active_task_type: ActiveTaskType = "idle";

  private request_in_flight_count = 0;

  private translation_scope: TranslationScope = { kind: "all" };

  private run_revision = 0;

  private active_run: ActiveRun | null = null;

  private readonly completions = new Set<Promise<void>>(); // finish 清除 active run 后仍跟踪 Engine 收尾与 lease 释放

  private disposed = false;

  private readonly listeners = new Set<TaskSnapshotListener>();

  private request_pressure_timer: ReturnType<typeof setTimeout> | null = null;

  private pending_request_pressure: PendingRequestPressure | null = null;

  private request_pressure_flush: Promise<void> = Promise.resolve();

  private readonly unsubscribe_project_session_change: () => void;

  /**
   * 订阅工程会话切换，确保任务运行态不会跨工程泄漏。
   */
  public constructor(
    private readonly session_state: ProjectSessionState,
    private readonly data_reader: ProjectDataReader,
    private readonly runtime_gate: RuntimeOperationGate,
  ) {
    this.unsubscribe_project_session_change = this.session_state.subscribe_change(
      async (change) => await this.reset_for_project_session(change),
    );
  }

  /**
   * 返回运行态值快照，调用方不能借数组引用改写内部 scope。
   */
  private snapshot_state(): TaskRuntimeStateSnapshot {
    return {
      run_revision: this.run_revision,
      status: this.status,
      request_in_flight_count: this.request_in_flight_count,
      active_task_type: this.active_task_type,
      translation_scope: clone_translation_scope(this.translation_scope),
    };
  }

  /**
   * 订阅完整任务快照；取消函数只移除当前 listener。
   */
  public subscribe(listener: TaskSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 进程关闭时停止公开更新；当前任务显式取消，但保留运行态等待自身收尾。
   */
  public async dispose(): Promise<void> {
    this.disposed = true;
    this.unsubscribe_project_session_change();
    this.listeners.clear();
    const active_run = this.active_run;
    active_run?.abort_controller.abort();
    if (active_run !== null && active_run.completion === null) {
      this.restore_state(active_run.previous_state);
      this.active_run = null;
      this.runtime_gate.finish_runtime(active_run.runtime_lease);
    }
    this.cancel_pending_request_pressure();
    await Promise.all([this.request_pressure_flush.catch(() => undefined), ...this.completions]);
  }

  /**
   * 原子预约一次任务；快照构造或 listener 失败时先恢复状态并释放运行锁。
   */
  public async begin(
    task_type: TaskType,
    scope: TranslationScope = { kind: "all" },
  ): Promise<TaskRunHandle> {
    if (this.disposed) {
      throw new AppErrors.AppError("runtime.disposed");
    }
    if (this.active_run !== null) throw new AppErrors.AppError("runtime.busy");
    const previous_state = this.snapshot_state();
    const abort_controller = new AbortController();
    const runtime_lease = this.runtime_gate.begin_runtime("task");
    const active_run: ActiveRun = {
      run_id: crypto.randomUUID(),
      task_type,
      abort_controller,
      runtime_lease,
      previous_state,
      completion: null,
    };
    this.active_run = active_run;
    this.status = "requested";
    this.active_task_type = task_type;
    this.request_in_flight_count = 0;
    if (task_type === "translation") {
      this.translation_scope = normalize_translation_scope(scope);
    }
    this.bump_run_revision();

    try {
      await this.publish_snapshot(task_type);
    } catch (error) {
      await this.restore_failed_begin(active_run, error);
    }
    return this.to_handle(active_run);
  }

  /**
   * Engine 启动后同步绑定真实运行 Promise，让关闭流程等待终态与运行 lease 全部释放。
   */
  public bind_completion(handle: TaskRunHandle, completion: Promise<void>): void {
    const active_run = this.read_current_run(handle.run_id);
    if (active_run === null) {
      throw new AppErrors.AppError("runtime.busy");
    }
    const tracked_completion = completion.catch(() => undefined);
    active_run.completion = tracked_completion;
    this.completions.add(tracked_completion);
    void tracked_completion.then(() => {
      this.completions.delete(tracked_completion);
    });
  }

  /**
   * Engine 尚未接管就失败时恢复预约前状态；发布失败不能阻止锁释放。
   */
  public async cancel_start(handle: TaskRunHandle): Promise<void> {
    const active_run = this.read_current_run(handle.run_id);
    if (active_run === null) {
      return;
    }
    this.cancel_pending_request_pressure();
    this.restore_state(active_run.previous_state);
    this.active_run = null;
    try {
      await this.publish_snapshot(this.resolve_snapshot_task_type(active_run.previous_state));
    } finally {
      this.runtime_gate.finish_runtime(active_run.runtime_lease);
    }
  }

  /**
   * 任务进入 running 或 stopping 后立即发布完整快照。
   */
  public async publish_status(
    handle: TaskRunHandle,
    status: "running" | "stopping",
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) {
      return;
    }
    this.status = status;
    this.active_task_type = handle.task_type;
    this.bump_run_revision();
    await this.publish_snapshot(handle.task_type);
  }

  /**
   * 停止命中当前任务后先传播取消，再发布 stopping。
   */
  public async request_stop(task_type: TaskType): Promise<boolean> {
    const active_run = this.active_run;
    if (active_run === null || active_run.task_type !== task_type) {
      return false;
    }
    active_run.abort_controller.abort();
    await this.publish_status(this.to_handle(active_run), "stopping");
    return true;
  }

  /**
   * 迟到提交必须以 run id 判断当前性。
   */
  public is_current(run_id: string): boolean {
    return this.active_run?.run_id === run_id;
  }

  /**
   * 已提交进度立即发布；重翻条目只根据存储返回的已提交 id 收缩。
   */
  public async publish_progress(
    handle: TaskRunHandle,
    committed_item_ids: number[] = [],
  ): Promise<void> {
    if (!this.is_current(handle.run_id)) {
      return;
    }
    this.cancel_pending_request_pressure();
    if (handle.task_type === "translation") {
      this.remove_translation_item_ids(committed_item_ids);
    }
    this.active_task_type = handle.task_type;
    this.bump_run_revision();
    await this.publish_snapshot(handle.task_type);
  }

  /**
   * 请求压力只保存在运行态，并按固定窗口合并公开快照。
   */
  public change_request_in_flight_count(handle: TaskRunHandle, delta: number): void {
    if (!this.is_current(handle.run_id)) {
      return;
    }
    this.request_in_flight_count = Math.max(
      0,
      this.request_in_flight_count + read_json_integer(delta, 0),
    );
    this.active_task_type = handle.task_type;
    this.pending_request_pressure = {
      run_id: handle.run_id,
      task_type: handle.task_type,
    };
    this.bump_run_revision();
    if (this.request_pressure_timer !== null) {
      return;
    }
    this.request_pressure_timer = setTimeout(() => {
      this.request_pressure_timer = null;
      void this.flush_request_pressure().catch(() => {
        // 定时压力帧失败不改变任务事实，下一次进度或生命周期快照会覆盖展示。
      });
    }, TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS);
  }

  /**
   * 终态前冲刷压力帧；失败会交给 finish 汇总，但不会污染后续 flush 链。
   */
  private async flush_request_pressure(): Promise<void> {
    this.cancel_pending_request_pressure_timer();
    const pending = this.pending_request_pressure;
    this.pending_request_pressure = null;
    if (pending === null) {
      await this.request_pressure_flush;
      return;
    }
    const flush = this.request_pressure_flush.then(async () => {
      if (this.is_current(pending.run_id)) {
        await this.publish_snapshot(pending.task_type);
      }
    });
    this.request_pressure_flush = flush.catch(() => undefined);
    await flush;
  }

  /**
   * 当前任务进入终态时先清除 active run，再发布快照，所有失败都不能遗留运行锁。
   */
  public async finish(handle: TaskRunHandle, status: "idle" | "done" | "error"): Promise<void> {
    const active_run = this.read_current_run(handle.run_id);
    if (active_run === null) return;
    const errors: unknown[] = [];
    try {
      await this.flush_request_pressure();
    } catch (error) {
      errors.push(error);
    }

    this.cancel_pending_request_pressure();
    this.status = status;
    this.active_task_type = "idle";
    this.request_in_flight_count = 0;
    this.translation_scope = { kind: "all" };
    this.active_run = null;
    this.bump_run_revision();

    try {
      await this.publish_snapshot(handle.task_type);
    } catch (error) {
      errors.push(error);
    } finally {
      this.runtime_gate.finish_runtime(active_run.runtime_lease);
    }
    this.throw_collected_errors(errors, "任务终态快照发布失败");
  }

  /**
   * 按请求任务类型构造完整公开快照。
   */
  public async build_snapshot(request: JsonRecord = {}): Promise<TaskSnapshot> {
    const runtime_state = this.snapshot_state();
    const meta = this.get_loaded_project_meta();
    const requested_task_type = String(request["task_type"] ?? "");
    const task_type = is_task_type(requested_task_type)
      ? requested_task_type
      : this.resolve_task_type(runtime_state, meta);
    const progress =
      task_type === "analysis"
        ? normalize_task_progress_snapshot({
            ...read_json_record(meta["analysis_extras"]),
          })
        : normalize_task_progress_snapshot({
            ...read_json_record(meta["translation_extras"]),
          });
    return {
      run_revision: runtime_state.run_revision,
      task_type,
      status: runtime_state.status,
      busy: this.active_run !== null,
      request_in_flight_count: runtime_state.request_in_flight_count,
      progress: progress as TaskProgress,
      extras:
        task_type === "analysis"
          ? {
              kind: "analysis",
              candidate_count: read_json_integer(meta["analysis_candidate_count"], 0),
            }
          : {
              kind: "translation",
              scope: runtime_state.translation_scope,
            },
    };
  }

  /**
   * 向所有 listener 发布完整快照；无订阅者时不读 meta。
   */
  private async publish_snapshot(task_type: TaskType): Promise<void> {
    if (this.listeners.size === 0) {
      return;
    }
    const snapshot = await this.build_snapshot({ task_type });
    const results = await Promise.allSettled(
      Array.from(this.listeners, (listener) =>
        Promise.resolve().then(async () => await listener(snapshot)),
      ),
    );
    this.throw_collected_errors(
      results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason),
      "任务快照 listener 执行失败",
    );
  }

  /**
   * 工程会话切换后清除旧工程任务终态并发布更高 revision 的新会话快照。
   */
  private async reset_for_project_session(change: Readonly<ProjectSessionChange>): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.active_run !== null) {
      throw new AppErrors.AppError("runtime.internal_invariant", {
        diagnostic_context: {
          reason: "project_session_changed_while_task_active",
          session_revision: change.sessionRevision,
        },
      });
    }
    this.cancel_pending_request_pressure();
    this.status = "idle";
    this.active_task_type = "idle";
    this.request_in_flight_count = 0;
    this.translation_scope = { kind: "all" };
    this.active_run = null;
    this.bump_run_revision();
    const meta = this.get_loaded_project_meta();
    await this.publish_snapshot(this.resolve_task_type(this.snapshot_state(), meta));
  }

  /**
   * begin 失败时回滚到启动前状态并尽量重新发布快照。
   */
  private async restore_failed_begin(active_run: ActiveRun, cause: unknown): Promise<never> {
    this.cancel_pending_request_pressure();
    this.restore_state(active_run.previous_state);
    this.active_run = null;
    let restore_error: unknown;
    try {
      await this.publish_snapshot(this.resolve_snapshot_task_type(active_run.previous_state));
    } catch (error) {
      restore_error = error;
    } finally {
      this.runtime_gate.finish_runtime(active_run.runtime_lease);
    }
    if (restore_error !== undefined) {
      throw new AggregateError(
        [cause, restore_error],
        "Task startup and recovery snapshot publication both failed.",
      );
    }
    throw cause;
  }

  /**
   * 用值快照恢复内存运行态，同时推进 run_revision。
   */
  private restore_state(snapshot: TaskRuntimeStateSnapshot): void {
    this.status = snapshot.status;
    this.request_in_flight_count = snapshot.request_in_flight_count;
    this.active_task_type = snapshot.active_task_type;
    this.translation_scope = normalize_translation_scope(snapshot.translation_scope);
    this.bump_run_revision();
  }

  /**
   * 行级重翻完成后从 items scope 中剔除已完成行。
   */
  private remove_translation_item_ids(item_ids: number[]): void {
    if (this.translation_scope.kind !== "items" || item_ids.length === 0) {
      return;
    }
    const done_scope = normalize_translation_scope({ kind: "items", item_ids });
    const done_ids = new Set(done_scope.kind === "items" ? done_scope.item_ids : []);
    this.translation_scope = {
      kind: "items",
      item_ids: this.translation_scope.item_ids.filter((item_id) => !done_ids.has(item_id)),
    };
  }

  /**
   * 未加载工程时返回空 meta，避免 snapshot 读取误创建路径。
   */
  private get_loaded_project_meta(): MutableJsonRecord {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      return {};
    }
    return { ...this.data_reader.get_all_meta(state.projectPath) };
  }

  /**
   * 活跃任务优先；idle 时按已有 progress 选择默认快照 task_type。
   */
  private resolve_task_type(runtime_state: TaskRuntimeStateSnapshot, meta: JsonRecord): TaskType {
    if (is_task_type(runtime_state.active_task_type)) {
      return runtime_state.active_task_type;
    }
    const translation_progress = normalize_task_progress_snapshot({
      ...read_json_record(meta["translation_extras"]),
    });
    if (read_json_integer(translation_progress["line"], 0) > 0) {
      return "translation";
    }
    const analysis_progress = normalize_task_progress_snapshot({
      ...read_json_record(meta["analysis_extras"]),
    });
    return read_json_integer(analysis_progress["line"], 0) > 0 ? "analysis" : "translation";
  }

  /** 只接受当前 active run 的 run_id。 */
  private read_current_run(run_id: string): ActiveRun | null {
    return this.active_run?.run_id === run_id ? this.active_run : null;
  }

  /** 把内部 active run 收窄为外部只读句柄。 */
  private to_handle(active_run: ActiveRun): TaskRunHandle {
    return {
      run_id: active_run.run_id,
      task_type: active_run.task_type,
      signal: active_run.abort_controller.signal,
    };
  }

  /** idle 快照默认按 translation 口径发布。 */
  private resolve_snapshot_task_type(snapshot: TaskRuntimeStateSnapshot): TaskType {
    return snapshot.active_task_type === "analysis" ? "analysis" : "translation";
  }

  /** 取消待发送的请求压力合并帧。 */
  private cancel_pending_request_pressure(): void {
    this.cancel_pending_request_pressure_timer();
    this.pending_request_pressure = null;
  }

  /** 清理请求压力节流 timer。 */
  private cancel_pending_request_pressure_timer(): void {
    if (this.request_pressure_timer === null) {
      return;
    }
    clearTimeout(this.request_pressure_timer);
    this.request_pressure_timer = null;
  }

  /** 每次状态跃迁推进前端排序用 revision。 */
  private bump_run_revision(): void {
    this.run_revision += 1;
  }

  /** 多个 listener 失败时保留全部原因。 */
  private throw_collected_errors(errors: unknown[], message: string): void {
    if (errors.length === 0) {
      return;
    }
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new AggregateError(errors, message);
  }
}
