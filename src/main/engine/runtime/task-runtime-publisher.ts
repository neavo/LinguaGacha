import type { ApiJsonValue } from "../../api/api-types";
import { CoreEventHub } from "../../events/core-event-hub";
import { TaskRuntimeState } from "./task-runtime-state";
import { TaskSnapshotBuilder } from "./task-snapshot-builder";
import type { TaskRunStatus, TaskRuntimeStatePayload, TaskType } from "./task-runtime-types";
import type { TranslationScope } from "../protocol/task-types";

export const TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS = 250; // 请求压力展示保持每秒 4 帧，任务事实仍立即发布

/**
 * 任务运行态公开事件唯一出口，负责写状态、构建完整快照并发布 SSE
 */
export class TaskRuntimePublisher {
  private readonly event_hub: CoreEventHub; // event_hub 只负责广播完整快照，不再投影 task 局部事件

  private readonly runtime_state: TaskRuntimeState; // runtime_state 是 busy/status/request pressure 的唯一写入目标

  private readonly snapshot_builder: TaskSnapshotBuilder; // snapshot_builder 统一从运行态和 `.lg` 事实构建公开 task

  private request_pressure_timer: ReturnType<typeof setTimeout> | null = null; // 仅请求压力允许后端 250ms 合并

  private pending_request_pressure_task_type: TaskType | null = null; // pending task_type 决定合并窗口最终发布哪类 snapshot

  private request_pressure_flush: Promise<void> = Promise.resolve(); // 串行化异步 flush，避免同一窗口内快照乱序

  /**
   * 注入任务运行态出口依赖，避免事件总线反向理解任务领域
   */
  public constructor(
    event_hub: CoreEventHub,
    runtime_state: TaskRuntimeState,
    snapshot_builder: TaskSnapshotBuilder,
  ) {
    this.event_hub = event_hub;
    this.runtime_state = runtime_state;
    this.snapshot_builder = snapshot_builder;
  }

  /**
   * 返回运行态快照，仅供命令失败回滚使用
   */
  public snapshot_state(): TaskRuntimeStatePayload {
    return this.runtime_state.snapshot();
  }

  /**
   * 命令受理后立即进入 requested，并发布完整快照
   */
  public async begin_task(
    task_type: TaskType,
    scope: TranslationScope = { kind: "all" },
  ): Promise<void> {
    this.runtime_state.begin_task(task_type, scope);
    await this.publish_snapshot(task_type);
  }

  /**
   * 停止命令立即进入 stopping，并发布完整快照
   */
  public async mark_stopping(task_type: TaskType): Promise<void> {
    this.runtime_state.mark_stopping(task_type);
    await this.publish_snapshot(task_type);
  }

  /**
   * 命令失败时恢复前置快照，并用完整快照覆盖已发布的乐观态
   */
  public async restore(snapshot: TaskRuntimeStatePayload): Promise<void> {
    this.runtime_state.restore(snapshot);
    await this.publish_snapshot(this.resolve_snapshot_task_type(snapshot));
  }

  /**
   * Engine 生命周期状态变化直接发布完整快照；终态前先冲刷请求压力窗口
   */
  public async publish_status(
    task_type: TaskType,
    status: TaskRunStatus,
    busy: boolean,
  ): Promise<void> {
    if (!busy) {
      await this.flush_request_pressure();
    }
    this.runtime_state.set_status(task_type, status, busy);
    await this.publish_snapshot(task_type);
  }

  /**
   * 任务提交进度后立即发布完整快照，进度字段从已提交 `.lg` meta 中读取
   */
  public async publish_progress_committed(task_type: TaskType): Promise<void> {
    this.cancel_pending_request_pressure();
    this.runtime_state.mark_progress_committed(task_type);
    await this.publish_snapshot(task_type);
  }

  /**
   * request_in_flight_count-only 变化只做 250ms 合并发布
   */
  public publish_request_pressure(task_type: TaskType, count: number): void {
    this.runtime_state.set_request_in_flight_count(task_type, count);
    this.pending_request_pressure_task_type = task_type;
    if (this.request_pressure_timer !== null) {
      return;
    }
    this.request_pressure_timer = setTimeout(() => {
      this.request_pressure_timer = null;
      void this.flush_request_pressure();
    }, TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS);
  }

  /**
   * 取消并冲刷请求压力窗口，供终态和测试收尾保持快照顺序
   */
  public async flush_request_pressure(): Promise<void> {
    if (this.request_pressure_timer !== null) {
      this.cancel_pending_request_pressure_timer();
    }
    const task_type = this.pending_request_pressure_task_type;
    this.pending_request_pressure_task_type = null;
    if (task_type === null) {
      await this.request_pressure_flush;
      return;
    }
    this.request_pressure_flush = this.request_pressure_flush.then(() =>
      this.publish_snapshot(task_type),
    );
    await this.request_pressure_flush;
  }

  /**
   * 发布完整 task.snapshot_changed；payload 中不再出现局部状态事件
   */
  private async publish_snapshot(task_type: TaskType): Promise<void> {
    const snapshot = await this.snapshot_builder.build_task_snapshot({ task_type });
    this.event_hub.publish("task.snapshot_changed", {
      task: snapshot as unknown as ApiJsonValue,
    });
  }

  /**
   * 进度提交快照已经包含当前请求压力，可直接吞掉未刷新的压力展示窗口
   */
  private cancel_pending_request_pressure(): void {
    this.cancel_pending_request_pressure_timer();
    this.pending_request_pressure_task_type = null;
  }

  /**
   * 清理请求压力 timer，避免提交快照后再补一帧重复压力
   */
  private cancel_pending_request_pressure_timer(): void {
    if (this.request_pressure_timer === null) {
      return;
    }
    clearTimeout(this.request_pressure_timer);
    this.request_pressure_timer = null;
  }

  /**
   * 恢复空闲态时快照类型回退给 builder 自行按持久进度选择
   */
  private resolve_snapshot_task_type(snapshot: TaskRuntimeStatePayload): TaskType {
    const task_type = snapshot.active_task_type;
    return task_type === "analysis" ? task_type : "translation";
  }
}
