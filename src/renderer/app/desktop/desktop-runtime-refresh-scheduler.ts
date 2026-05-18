import type { ProjectStoreChangeEvent } from "@/project/store/project-store";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";

export const DESKTOP_RUNTIME_REFRESH_INTERVAL_MS = 500; // renderer 运行态刷新固定为每秒 2 帧

export type DesktopRuntimeProjectItemsReadRequest = {
  eventId?: string;
  source: string;
  projectPath: string; // 补读发起时的项目路径，用于丢弃项目切换后的迟到响应
  projectEpoch: number; // 补读发起时的运行态 epoch，用于丢弃同路径重新 warmup 的迟到响应
  projectRevision: number;
  itemIds: number[];
};

type DesktopRuntimeRefreshSchedulerOptions = {
  applyTaskSnapshot: (snapshot: TaskSnapshot) => void; // flush 阶段唯一写入 TaskRuntimeStore 的回调
  applyProjectChangeBatch: (events: readonly ProjectStoreChangeEvent[]) => void; // flush 阶段唯一批量写入 ProjectStore 的回调
  readProjectItemsByIds?: (
    request: DesktopRuntimeProjectItemsReadRequest,
  ) => Promise<ProjectStoreChangeEvent | null>; // ids-only 在 flush 阶段补读成 canonical delta
  shouldApplyProjectChange?: (event: ProjectStoreChangeEvent) => boolean; // 异步补读返回后防止旧 revision 回写
  handleProjectRefreshError?: (error: unknown) => void; // 补读失败交给宿主运行态决定是否静默
};

type PendingProjectRefresh =
  | {
      kind: "change";
      event: ProjectStoreChangeEvent;
    }
  | {
      kind: "items-read";
      request: DesktopRuntimeProjectItemsReadRequest;
    };

/**
 * renderer 运行态刷新调度器，统一合并 task snapshot 与可批量 project change
 */
export class DesktopRuntimeRefreshScheduler {
  private readonly apply_task_snapshot: (snapshot: TaskSnapshot) => void; // 只在 flush 时覆盖 TaskRuntimeStore

  private readonly apply_project_change_batch: (events: readonly ProjectStoreChangeEvent[]) => void; // 保留 project event 到达顺序，flush 时只通知一次 ProjectStore

  private readonly read_project_items_by_ids:
    | ((request: DesktopRuntimeProjectItemsReadRequest) => Promise<ProjectStoreChangeEvent | null>)
    | null; // ids-only 只在调度器 flush 阶段补读，避免事件 handler 里散落异步写入口

  private readonly should_apply_project_change: (event: ProjectStoreChangeEvent) => boolean;

  private readonly handle_project_refresh_error: (error: unknown) => void;

  private pending_task_snapshot: TaskSnapshot | null = null; // task snapshot 是覆盖式事实，同一窗口只保留最后一份

  private readonly pending_project_refreshes: PendingProjectRefresh[] = []; // project change 必须顺序处理，ids-only 先补读再写入

  private refresh_timer: ReturnType<typeof setTimeout> | null = null; // 500ms 窗口内只允许一个待触发 timer

  private project_refresh_sequence: Promise<void> = Promise.resolve(); // 串行化异步补读，避免旧请求晚返回覆盖新事实

  private disposed = false; // 卸载后丢弃所有迟到异步结果

  /**
   * 注入具体 store 写入口，让调度器只负责节流，不成为第二套状态源
   */
  public constructor(options: DesktopRuntimeRefreshSchedulerOptions) {
    this.apply_task_snapshot = options.applyTaskSnapshot;
    this.apply_project_change_batch = options.applyProjectChangeBatch;
    this.read_project_items_by_ids = options.readProjectItemsByIds ?? null;
    this.should_apply_project_change = options.shouldApplyProjectChange ?? (() => true);
    this.handle_project_refresh_error = options.handleProjectRefreshError ?? (() => undefined);
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
    this.pending_project_refreshes.push({
      kind: "change",
      event: change_event,
    });
    this.ensure_timer();
  }

  /**
   * 记录 ids-only 补读请求；同一窗口内 item id 会合并成一次公开行读取
   */
  public enqueue_project_items_read(request: DesktopRuntimeProjectItemsReadRequest): void {
    if (this.disposed) {
      return;
    }
    const item_ids = [...new Set(request.itemIds.filter((item_id) => item_id > 0))];
    if (item_ids.length === 0) {
      return;
    }

    this.pending_project_refreshes.push({
      kind: "items-read",
      request: {
        ...request,
        eventId: request.eventId,
        itemIds: item_ids,
      },
    });
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
    const project_refreshes = this.pending_project_refreshes.splice(
      0,
      this.pending_project_refreshes.length,
    );
    const task_snapshot = this.pending_task_snapshot;
    this.pending_task_snapshot = null;

    if (project_refreshes.length > 0) {
      this.project_refresh_sequence = this.project_refresh_sequence
        .then(() => this.flush_project_refreshes(project_refreshes))
        .catch((error: unknown) => {
          this.handle_project_refresh_error(error);
        });
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
    this.pending_project_refreshes.length = 0;
  }

  /**
   * project refresh 可能包含异步 ids-only 补读；所有结果串行收口后再批量通知 store
   */
  private async flush_project_refreshes(
    refreshes: readonly PendingProjectRefresh[],
  ): Promise<void> {
    const project_changes = await this.resolve_project_refresh_events(refreshes);
    if (this.disposed) {
      return;
    }

    const fresh_changes = project_changes.filter((event): event is ProjectStoreChangeEvent => {
      return event !== null && this.should_apply_project_change(event);
    });
    if (fresh_changes.length === 0) {
      return;
    }

    this.apply_project_change_batch(fresh_changes);
  }

  /**
   * 按到达顺序解析 project refresh；连续 ids-only 合并读取，遇到 canonical delta 先收口前一组
   */
  private async resolve_project_refresh_events(
    refreshes: readonly PendingProjectRefresh[],
  ): Promise<Array<ProjectStoreChangeEvent | null>> {
    const events: Array<ProjectStoreChangeEvent | null> = [];
    let pending_item_reads: DesktopRuntimeProjectItemsReadRequest[] = [];

    const flush_pending_item_reads = async (): Promise<void> => {
      if (pending_item_reads.length === 0) {
        return;
      }
      events.push(...(await this.read_project_items_by_ids_batches(pending_item_reads)));
      pending_item_reads = [];
    };

    for (const refresh of refreshes) {
      if (refresh.kind === "items-read") {
        pending_item_reads.push(refresh.request);
        continue;
      }
      await flush_pending_item_reads();
      events.push(refresh.event);
    }
    await flush_pending_item_reads();

    return events;
  }

  /**
   * 连续 ids-only 只合并相同项目身份，避免旧 epoch 污染新项目镜像或打乱到达顺序
   */
  private async read_project_items_by_ids_batches(
    requests: readonly DesktopRuntimeProjectItemsReadRequest[],
  ): Promise<Array<ProjectStoreChangeEvent | null>> {
    const request_batches: DesktopRuntimeProjectItemsReadRequest[][] = [];
    let current_batch: DesktopRuntimeProjectItemsReadRequest[] = [];
    for (const request of requests) {
      const identity = current_batch[0];
      if (
        identity === undefined ||
        (identity.projectPath === request.projectPath &&
          identity.projectEpoch === request.projectEpoch)
      ) {
        current_batch.push(request);
        continue;
      }

      request_batches.push(current_batch);
      current_batch = [request];
    }
    if (current_batch.length > 0) {
      request_batches.push(current_batch);
    }

    const events: Array<ProjectStoreChangeEvent | null> = [];
    for (const request_batch of request_batches) {
      events.push(await this.read_project_items_by_ids_batch(request_batch));
    }
    return events;
  }

  /**
   * 同一项目身份内合并 item id，避免高频任务提交放大 HTTP 请求
   */
  private async read_project_items_by_ids_batch(
    requests: readonly DesktopRuntimeProjectItemsReadRequest[],
  ): Promise<ProjectStoreChangeEvent | null> {
    if (this.read_project_items_by_ids === null || requests.length === 0) {
      return null;
    }

    const sources = [...new Set(requests.map((request) => request.source))];
    const project_paths = [...new Set(requests.map((request) => request.projectPath))];
    const project_epochs = [...new Set(requests.map((request) => request.projectEpoch))];
    if (project_paths.length !== 1 || project_epochs.length !== 1) {
      return null;
    }
    const event_ids = [
      ...new Set(
        requests.map((request) => request.eventId ?? "").filter((event_id) => event_id !== ""),
      ),
    ];
    const item_ids = [...new Set(requests.flatMap((request) => request.itemIds))];
    return await this.read_project_items_by_ids({
      ...(event_ids.length === 1 ? { eventId: event_ids[0] } : {}),
      source: sources.length === 1 ? (sources[0] ?? "project_change") : "project_change_batch",
      projectPath: project_paths[0] ?? "",
      projectEpoch: project_epochs[0] ?? 0,
      projectRevision: Math.max(...requests.map((request) => request.projectRevision), 0),
      itemIds: item_ids,
    });
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
