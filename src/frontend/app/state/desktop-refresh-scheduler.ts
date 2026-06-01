import type { ProjectChangeEventForState } from "@frontend/app/state/desktop-project-change-types";
import type { TaskSnapshot } from "@frontend/app/state/task-snapshot-store";

// 渲染进程运行态刷新固定为每秒 2 帧，兼顾任务进度流畅度和 React 重渲染成本。
export const DESKTOP_RUNTIME_REFRESH_INTERVAL_MS = 500;

type DesktopRefreshSchedulerOptions = {
  applyTaskSnapshot: (snapshot: TaskSnapshot) => void; // flush 阶段唯一写入 TaskSnapshotStore 的回调
  applyProjectChangeBatch: (events: readonly ProjectChangeEventForState[]) => void; // flush 阶段唯一批量发布项目变更信号的回调
  shouldApplyProjectChange?: (event: ProjectChangeEventForState) => boolean; // flush 前过滤旧 project revision
  onFlushError: (error: unknown, context: DesktopRefreshSchedulerErrorContext) => void; // 调度器内部异常由运行态统一记录和恢复
};

export type DesktopRefreshSchedulerErrorContext = {
  phase: "project_change_batch" | "task_snapshot";
  projectChanges: readonly ProjectChangeEventForState[];
  taskSnapshot: TaskSnapshot | null;
};

/**
 * 渲染进程运行态刷新调度器，统一合并 task snapshot 与可批量 project change
 */
export class DesktopRefreshScheduler {
  private readonly apply_task_snapshot: (snapshot: TaskSnapshot) => void; // 只在 flush 时覆盖 TaskSnapshotStore

  private readonly apply_project_change_batch: (
    events: readonly ProjectChangeEventForState[],
  ) => void; // 保留 project event 到达顺序，flush 时只通知一次运行态

  private readonly should_apply_project_change: (event: ProjectChangeEventForState) => boolean;

  private readonly on_flush_error: (
    error: unknown,
    context: DesktopRefreshSchedulerErrorContext,
  ) => void;

  private pending_task_snapshot: TaskSnapshot | null = null; // task snapshot 是覆盖式事实，同一窗口只保留最后一份

  private readonly pending_project_changes: ProjectChangeEventForState[] = []; // project change 必须按到达顺序批量发布

  private refresh_timer: ReturnType<typeof setTimeout> | null = null; // 500ms 窗口内只允许一个待触发 timer

  private disposed = false; // 卸载后丢弃所有迟到 timer 回调

  /**
   * 注入具体 store 写入口，让调度器只负责节流，不成为第二套状态源
   */
  public constructor(options: DesktopRefreshSchedulerOptions) {
    this.apply_task_snapshot = options.applyTaskSnapshot;
    this.apply_project_change_batch = options.applyProjectChangeBatch;
    this.should_apply_project_change = options.shouldApplyProjectChange ?? (() => true);
    this.on_flush_error = options.onFlushError;
  }

  /**
   * 记录最新 task snapshot；运行中高频进度和请求压力由下一次 flush 合并到一帧
   */
  public enqueue_task_snapshot(snapshot: TaskSnapshot): void {
    if (this.disposed) {
      return;
    }
    this.pending_task_snapshot = snapshot;
    this.ensure_timer();
  }

  /**
   * 记录可批量 project change；规范化增量按到达顺序进入同一个刷新窗口
   */
  public enqueue_project_change(change_event: ProjectChangeEventForState): void {
    if (this.disposed) {
      return;
    }
    this.pending_project_changes.push(change_event);
    this.ensure_timer();
  }

  /**
   * 立即冲刷 pending 队列，供工程切换、写入结果、失效补读和任务终态保持顺序
   */
  public flush(): void {
    if (this.disposed) {
      return;
    }
    this.clear_timer();
    const project_changes = this.pending_project_changes.splice(
      0,
      this.pending_project_changes.length,
    );
    const task_snapshot = this.pending_task_snapshot;
    this.pending_task_snapshot = null;

    this.flush_project_changes(project_changes, task_snapshot);
    this.flush_task_snapshot(task_snapshot, project_changes);
  }

  /**
   * 清理窗口 timer 和 pending 引用，避免 StrictMode 重挂载或卸载后残留旧回调
   */
  public dispose(): void {
    this.disposed = true;
    this.clear_timer();
    this.pending_task_snapshot = null;
    this.pending_project_changes.length = 0;
  }

  /**
   * 第一个 pending 事件负责启动窗口，后续事件只合并到同一帧
   */
  private ensure_timer(): void {
    if (this.disposed) {
      return;
    }
    if (this.refresh_timer !== null) {
      return;
    }

    this.refresh_timer = setTimeout(() => {
      this.refresh_timer = null;
      this.flush();
    }, DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);
  }

  /**
   * 项目变更失败时只丢弃当前 pending 批次并上报，恢复由 DesktopStateProvider 读取后端权威快照完成。
   */
  private flush_project_changes(
    projectChanges: ProjectChangeEventForState[],
    taskSnapshot: TaskSnapshot | null,
  ): void {
    if (projectChanges.length === 0) {
      return;
    }

    try {
      const fresh_changes = projectChanges.filter((event) =>
        this.should_apply_project_change(event),
      );
      if (fresh_changes.length > 0) {
        this.apply_project_change_batch(fresh_changes);
      }
    } catch (error) {
      this.on_flush_error(error, {
        phase: "project_change_batch",
        projectChanges,
        taskSnapshot,
      });
    }
  }

  /**
   * task snapshot 与 project change 相互独立；project 批次失败也不阻断最新任务状态落地。
   */
  private flush_task_snapshot(
    taskSnapshot: TaskSnapshot | null,
    projectChanges: readonly ProjectChangeEventForState[],
  ): void {
    if (taskSnapshot === null) {
      return;
    }

    try {
      this.apply_task_snapshot(taskSnapshot);
    } catch (error) {
      this.on_flush_error(error, {
        phase: "task_snapshot",
        projectChanges,
        taskSnapshot,
      });
    }
  }

  /**
   * 清除当前 timer；flush 和 dispose 都走这里，避免重复清理分支
   */
  private clear_timer(): void {
    if (this.refresh_timer === null) {
      return;
    }
    clearTimeout(this.refresh_timer);
    this.refresh_timer = null;
  }
}
