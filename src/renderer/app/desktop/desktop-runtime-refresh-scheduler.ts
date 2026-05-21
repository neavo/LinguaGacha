import type { ProjectStoreChangeEvent } from "@/project/store/project-store";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";

export const DESKTOP_RUNTIME_REFRESH_INTERVAL_MS = 500; // renderer 运行态刷新固定为每秒 2 帧

type DesktopRuntimeRefreshSchedulerOptions = {
  applyTaskSnapshot: (snapshot: TaskSnapshot) => void; // flush 阶段唯一写入 TaskRuntimeStore 的回调
  applyProjectChangeBatch: (events: readonly ProjectStoreChangeEvent[]) => void; // flush 阶段唯一批量写入 ProjectStore 的回调
  shouldApplyProjectChange?: (event: ProjectStoreChangeEvent) => boolean; // flush 前过滤旧 project revision
};

/**
 * renderer 运行态刷新调度器，统一合并 task snapshot 与可批量 project change
 */
export class DesktopRuntimeRefreshScheduler {
  private readonly apply_task_snapshot: (snapshot: TaskSnapshot) => void; // 只在 flush 时覆盖 TaskRuntimeStore

  private readonly apply_project_change_batch: (events: readonly ProjectStoreChangeEvent[]) => void; // 保留 project event 到达顺序，flush 时只通知一次 ProjectStore

  private readonly should_apply_project_change: (event: ProjectStoreChangeEvent) => boolean;

  private pending_task_snapshot: TaskSnapshot | null = null; // task snapshot 是覆盖式事实，同一窗口只保留最后一份

  private readonly pending_project_changes: ProjectStoreChangeEvent[] = []; // project change 必须按到达顺序批量写入

  private refresh_timer: ReturnType<typeof setTimeout> | null = null; // 500ms 窗口内只允许一个待触发 timer

  private disposed = false; // 卸载后丢弃所有迟到 timer 回调

  /**
   * 注入具体 store 写入口，让调度器只负责节流，不成为第二套状态源
   */
  public constructor(options: DesktopRuntimeRefreshSchedulerOptions) {
    this.apply_task_snapshot = options.applyTaskSnapshot;
    this.apply_project_change_batch = options.applyProjectChangeBatch;
    this.should_apply_project_change = options.shouldApplyProjectChange ?? (() => true);
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
   * 记录可批量 project change；canonical delta 按到达顺序进入同一个刷新窗口
   */
  public enqueue_project_change(change_event: ProjectStoreChangeEvent): void {
    if (this.disposed) {
      return;
    }
    this.pending_project_changes.push(change_event);
    this.ensure_timer();
  }

  /**
   * 立即冲刷 pending 队列，供工程切换、mutation result、失效补读和任务终态保持顺序
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

    if (project_changes.length > 0) {
      const fresh_changes = project_changes.filter((event) =>
        this.should_apply_project_change(event),
      );
      if (fresh_changes.length > 0) {
        this.apply_project_change_batch(fresh_changes);
      }
    }
    if (task_snapshot !== null) {
      this.apply_task_snapshot(task_snapshot);
    }
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
