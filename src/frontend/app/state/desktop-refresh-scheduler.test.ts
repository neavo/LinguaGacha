import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectChangeEventForState } from "@frontend/app/state/desktop-project-change-types";
import type { TaskSnapshot } from "@frontend/app/state/task-snapshot-store";
import {
  DESKTOP_RUNTIME_REFRESH_INTERVAL_MS,
  DesktopRefreshScheduler,
} from "@frontend/app/state/desktop-refresh-scheduler";

describe("DesktopRefreshScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同一窗口内只应用最后一份 task snapshot", async () => {
    vi.useFakeTimers();
    const applied_tasks: TaskSnapshot[] = [];
    const scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: (snapshot) => {
        applied_tasks.push(snapshot);
      },
      applyProjectChangeBatch: () => {},
      onFlushError: noop_flush_error_handler,
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
    const applied_batches: ProjectChangeEventForState[][] = [];
    const scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: () => {},
      applyProjectChangeBatch: (events) => {
        applied_batches.push([...events]);
      },
      onFlushError: noop_flush_error_handler,
    });

    scheduler.enqueue_project_change(create_project_change(2));
    scheduler.enqueue_project_change(create_project_change(3));

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(applied_batches).toHaveLength(1);
    expect(applied_batches[0]?.map((event) => event.projectRevision)).toEqual([2, 3]);
  });

  it("flush 前会过滤旧 project change", async () => {
    vi.useFakeTimers();
    const apply_project_change_batch = vi.fn();
    const scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: () => {},
      applyProjectChangeBatch: apply_project_change_batch,
      shouldApplyProjectChange: (event) => event.projectRevision >= 5,
      onFlushError: noop_flush_error_handler,
    });

    scheduler.enqueue_project_change(create_project_change(4));

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(apply_project_change_batch).not.toHaveBeenCalled();
  });

  it("project 批次失败时上报错误并继续落地 task snapshot", async () => {
    vi.useFakeTimers();
    const apply_task_snapshot = vi.fn();
    const flush_errors: Array<{ error: unknown; phase: string }> = [];
    const scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: apply_task_snapshot,
      applyProjectChangeBatch: () => {
        throw new Error("project batch failed");
      },
      onFlushError: (error, context) => {
        flush_errors.push({ error, phase: context.phase });
      },
    });

    scheduler.enqueue_project_change(create_project_change(2));
    scheduler.enqueue_task_snapshot(create_task_snapshot(3));

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(flush_errors).toHaveLength(1);
    expect(flush_errors[0]?.phase).toBe("project_change_batch");
    expect(apply_task_snapshot).toHaveBeenCalledWith(create_task_snapshot(3));
  });

  it("task snapshot 写入失败时上报错误", async () => {
    vi.useFakeTimers();
    const flush_errors: Array<{ error: unknown; phase: string }> = [];
    const scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: () => {
        throw new Error("task snapshot failed");
      },
      applyProjectChangeBatch: () => {},
      onFlushError: (error, context) => {
        flush_errors.push({ error, phase: context.phase });
      },
    });

    scheduler.enqueue_task_snapshot(create_task_snapshot(5));

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(flush_errors).toHaveLength(1);
    expect(flush_errors[0]?.phase).toBe("task_snapshot");
  });

  it("dispose 会清理 timer 和 pending 事件", async () => {
    vi.useFakeTimers();
    const apply_task_snapshot = vi.fn();
    const apply_project_change_batch = vi.fn();
    const scheduler = new DesktopRefreshScheduler({
      applyTaskSnapshot: apply_task_snapshot,
      applyProjectChangeBatch: apply_project_change_batch,
      onFlushError: noop_flush_error_handler,
    });

    scheduler.enqueue_task_snapshot(create_task_snapshot(1));
    scheduler.enqueue_project_change(create_project_change(2));
    scheduler.dispose();

    await vi.advanceTimersByTimeAsync(DESKTOP_RUNTIME_REFRESH_INTERVAL_MS);

    expect(apply_task_snapshot).not.toHaveBeenCalled();
    expect(apply_project_change_batch).not.toHaveBeenCalled();
  });
});

// noop_flush_error_handler 构造测试所需的稳定夹具，避免每个用例重复铺设环境。
function noop_flush_error_handler(): void {}

// 构造最小可用 task snapshot，方便断言调度器只保留最新运行态
function create_task_snapshot(line: number): TaskSnapshot {
  return {
    run_revision: line,
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

// 构造带 revision 的 item 增量，方便断言 project 批次顺序
function create_project_change(
  projectRevision: number,
  itemIds: number[] = [projectRevision],
  source = "translation_batch",
): ProjectChangeEventForState {
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
