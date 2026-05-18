import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectStoreChangeEvent } from "@/project/store/project-store";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";
import {
  DESKTOP_RUNTIME_REFRESH_INTERVAL_MS,
  DesktopRuntimeRefreshScheduler,
} from "@/app/desktop/desktop-runtime-refresh-scheduler";

describe("DesktopRuntimeRefreshScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同一窗口内只应用最后一份 task snapshot", async () => {
    vi.useFakeTimers();
    const applied_tasks: TaskSnapshot[] = [];
    const scheduler = new DesktopRuntimeRefreshScheduler({
      applyTaskSnapshot: (snapshot) => {
        applied_tasks.push(snapshot);
      },
      applyProjectChangeBatch: () => {},
    });

    scheduler.enqueue_task_snapshot(create_task_snapshot(1));
    scheduler.enqueue_task_snapshot(create_task_snapshot(2));

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS - 1);
    expect(applied_tasks).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(applied_tasks.map((snapshot) => snapshot.progress.line)).toEqual([2]);
  });

  it("同一窗口内按到达顺序批量应用 project change", async () => {
    vi.useFakeTimers();
    const applied_batches: ProjectStoreChangeEvent[][] = [];
    const scheduler = new DesktopRuntimeRefreshScheduler({
      applyTaskSnapshot: () => {},
      applyProjectChangeBatch: (events) => {
        applied_batches.push([...events]);
      },
    });

    scheduler.enqueue_project_change(create_project_change(2));
    scheduler.enqueue_project_change(create_project_change(3));

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(applied_batches).toHaveLength(1);
    expect(applied_batches[0]?.map((event) => event.projectRevision)).toEqual([2, 3]);
  });

  it("同一窗口内合并 ids-only item 读取后再应用 project change", async () => {
    vi.useFakeTimers();
    const read_requests: number[][] = [];
    const applied_batches: ProjectStoreChangeEvent[][] = [];
    const scheduler = new DesktopRuntimeRefreshScheduler({
      applyTaskSnapshot: () => {},
      applyProjectChangeBatch: (events) => {
        applied_batches.push([...events]);
      },
      readProjectItemsByIds: async (request) => {
        read_requests.push([...request.itemIds]);
        return create_project_change(request.projectRevision, request.itemIds, request.source);
      },
    });

    scheduler.enqueue_project_items_read({
      source: "translation_commit",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 2,
      itemIds: [2, 3],
    });
    scheduler.enqueue_project_items_read({
      source: "translation_commit",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 3,
      itemIds: [3, 4],
    });

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);
    await Promise.resolve();

    expect(read_requests).toEqual([[2, 3, 4]]);
    expect(applied_batches).toHaveLength(1);
    expect(applied_batches[0]?.[0]).toMatchObject({
      source: "translation_commit",
      projectRevision: 3,
    });
    expect(applied_batches[0]?.[0]?.operations[0]?.items?.changedIds).toEqual([2, 3, 4]);
  });

  it("ids-only 补读响应过期时不写入 ProjectStore", async () => {
    vi.useFakeTimers();
    const apply_project_change_batch = vi.fn();
    const scheduler = new DesktopRuntimeRefreshScheduler({
      applyTaskSnapshot: () => {},
      applyProjectChangeBatch: apply_project_change_batch,
      readProjectItemsByIds: async (request) => create_project_change(request.projectRevision),
      shouldApplyProjectChange: (event) => event.projectRevision >= 5,
    });

    scheduler.enqueue_project_items_read({
      source: "translation_commit",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 4,
      itemIds: [4],
    });

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);
    await Promise.resolve();

    expect(apply_project_change_batch).not.toHaveBeenCalled();
  });

  it("dispose 会清理 timer 和 pending 事件", async () => {
    vi.useFakeTimers();
    const apply_task_snapshot = vi.fn();
    const apply_project_change_batch = vi.fn();
    const scheduler = new DesktopRuntimeRefreshScheduler({
      applyTaskSnapshot: apply_task_snapshot,
      applyProjectChangeBatch: apply_project_change_batch,
    });

    scheduler.enqueue_task_snapshot(create_task_snapshot(1));
    scheduler.enqueue_project_change(create_project_change(2));
    scheduler.enqueue_project_items_read({
      source: "translation_commit",
      projectPath: "E:/demo/demo.lg",
      projectRevision: 3,
      itemIds: [3],
    });
    scheduler.dispose();

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(apply_task_snapshot).not.toHaveBeenCalled();
    expect(apply_project_change_batch).not.toHaveBeenCalled();
  });
});

// 构造最小可用 task snapshot，方便断言调度器只保留最新运行态
function create_task_snapshot(line: number): TaskSnapshot {
  return {
    runtime_revision: line,
    task_type: "translation",
    status: "running",
    busy: true,
    request_in_flight_count: line,
    progress: {
      line,
      total_line: 10,
      processed_line: line,
      error_line: 0,
      total_tokens: 0,
      total_output_tokens: 0,
      total_input_tokens: 0,
      time: 0,
      start_time: 0,
    },
    extras: { kind: "translation", scope: { kind: "all" } },
  };
}

// 构造带 revision 的 item delta，方便断言 project 批次顺序
function create_project_change(
  projectRevision: number,
  itemIds: number[] = [projectRevision],
  source = "translation_batch",
): ProjectStoreChangeEvent {
  return {
    source,
    projectPath: "E:/demo/demo.lg",
    projectRevision,
    updatedSections: ["items"],
    operations: [
      {
        items: {
          payloadMode: "canonical-delta",
          changedIds: itemIds,
          upsert: Object.fromEntries(
            itemIds.map((item_id) => [
              String(item_id),
              {
                item_id,
                status: "PROCESSED",
              },
            ]),
          ),
        },
      },
    ],
  };
}
