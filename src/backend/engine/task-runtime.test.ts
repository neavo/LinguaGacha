import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { ProjectDataReader } from "../project/project-data-reader";
import { ProjectSessionState } from "../project/project-session-state";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import type { TranslationScope } from "../../domain/task";
import type { TaskSnapshot } from "./protocol/task-snapshot";
import { TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS, TaskRuntime } from "./task-runtime";

describe("TaskRuntime", () => {
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    vi.useRealTimers();
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("原子预约任务并返回不可变 scope 快照", async () => {
    const runtime = create_empty_runtime();
    const handle = await runtime.begin("translation", {
      kind: "items",
      item_ids: [3, 3, 0, 2.9, 4],
    } as unknown as TranslationScope);

    const snapshot = await runtime.build_snapshot({ task_type: "translation" });
    expect(snapshot).toMatchObject({
      task_type: "translation",
      status: "requested",
      busy: true,
      extras: { kind: "translation", scope: { kind: "items", item_ids: [3, 4] } },
    });
    if (snapshot.extras.kind !== "translation" || snapshot.extras.scope.kind !== "items") {
      throw new Error("期望重翻 items scope");
    }
    snapshot.extras.scope.item_ids.push(99);

    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      extras: { kind: "translation", scope: { kind: "items", item_ids: [3, 4] } },
    });
    await expect(runtime.begin("analysis")).rejects.toThrow("runtime.busy");
    await runtime.finish(handle, "done");
  });

  it("用数据库进度事实和运行态组装完整任务快照", async () => {
    const { database, project_path } = create_project_database();
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    seed_project(database, project_path);
    const runtime = new TaskRuntime(
      session_state,
      new ProjectDataReader(database),
      new RuntimeOperationGate(),
    );
    const handle = await runtime.begin("translation", {
      kind: "items",
      item_ids: [101],
    });
    runtime.change_request_in_flight_count(handle, 2);

    const translation = await runtime.build_snapshot({
      task_type: "translation",
    });
    const analysis = await runtime.build_snapshot({ task_type: "analysis" });

    expect(translation).toMatchObject({
      task_type: "translation",
      status: "requested",
      busy: true,
      request_in_flight_count: 2,
      progress: {
        line: 5,
        total_line: 10,
        total_tokens: 42,
      },
      extras: {
        kind: "translation",
        scope: { kind: "items", item_ids: [101] },
      },
    });
    expect(analysis).toMatchObject({
      task_type: "analysis",
      progress: {
        line: 4,
        total_line: 9,
        processed_line: 4,
        error_line: 0,
      },
      extras: {
        kind: "analysis",
        candidate_count: 3,
      },
    });
    await runtime.finish(handle, "done");
  });

  it("工程切换和卸载会重置旧任务终态并发布更高 revision 的新会话快照", async () => {
    const session_state = new ProjectSessionState();
    const meta_by_project = new Map<string, Record<string, unknown>>([
      [
        "E:/Project/a.lg",
        {
          translation_extras: {
            line: 4,
            total_line: 8,
            processed_line: 4,
          },
        },
      ],
      [
        "E:/Project/b.lg",
        {
          translation_extras: {
            line: 2,
            total_line: 9,
            processed_line: 2,
          },
        },
      ],
    ]);
    const runtime = new TaskRuntime(
      session_state,
      {
        get_all_meta: (project_path: string) => meta_by_project.get(project_path) ?? {},
      } as unknown as ProjectDataReader,
      new RuntimeOperationGate(),
    );
    const published_snapshots: TaskSnapshot[] = [];
    runtime.subscribe((snapshot) => {
      published_snapshots.push(snapshot);
    });
    await session_state.mark_loaded("E:/Project/a.lg");
    const handle = await runtime.begin("translation");
    await runtime.finish(handle, "done");
    const delayed_a_snapshot = await runtime.build_snapshot({
      task_type: "translation",
    });

    await session_state.mark_loaded("E:/Project/b.lg");
    const b_snapshot = published_snapshots.at(-1);

    expect(b_snapshot).toMatchObject({
      task_type: "translation",
      status: "idle",
      busy: false,
      progress: {
        line: 2,
        total_line: 9,
        processed_line: 2,
      },
      extras: {
        kind: "translation",
        scope: { kind: "all" },
      },
    });
    expect(b_snapshot?.run_revision).toBeGreaterThan(delayed_a_snapshot.run_revision);

    await session_state.clear();
    const unloaded_snapshot = published_snapshots.at(-1);

    expect(unloaded_snapshot).toMatchObject({
      status: "idle",
      busy: false,
      progress: {
        line: 0,
        total_line: 0,
      },
    });
    expect(unloaded_snapshot?.run_revision).toBeGreaterThan(b_snapshot?.run_revision ?? 0);

    await runtime.dispose();
    const revision_after_dispose = (await runtime.build_snapshot()).run_revision;
    await session_state.mark_loaded("E:/Project/a.lg");
    expect((await runtime.build_snapshot()).run_revision).toBe(revision_after_dispose);
  });

  it("请求压力只按固定窗口发布一次完整快照", async () => {
    vi.useFakeTimers();
    const runtime = create_empty_runtime();
    const snapshots: TaskSnapshot[] = [];
    runtime.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    const handle = await runtime.begin("analysis");
    snapshots.length = 0;

    runtime.change_request_in_flight_count(handle, 1);
    runtime.change_request_in_flight_count(handle, 1);
    await Promise.resolve();
    expect(snapshots).toEqual([]);

    await vi.advanceTimersByTimeAsync(TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      task_type: "analysis",
      request_in_flight_count: 2,
    });
    await runtime.finish(handle, "done");
  });

  it("关闭时取消压力定时器并移除已有 listener", async () => {
    vi.useFakeTimers();
    const runtime = create_empty_runtime();
    const listener = vi.fn();
    runtime.subscribe(listener);
    const handle = await runtime.begin("analysis");
    listener.mockClear();

    runtime.change_request_in_flight_count(handle, 1);
    expect(vi.getTimerCount()).toBe(1);

    await runtime.dispose();

    expect(handle.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(TASK_REQUEST_PRESSURE_PUBLISH_INTERVAL_MS);
    await runtime.finish(handle, "idle");
    expect(listener).not.toHaveBeenCalled();
    await expect(runtime.begin("analysis")).rejects.toThrow("runtime.disposed");
  });

  it("finish 清除 active run 后关闭仍等待 Engine 收尾", async () => {
    const runtime = create_empty_runtime();
    let release_terminal_publish: () => void = () => undefined;
    let mark_terminal_publish_started: () => void = () => undefined;
    const terminal_publish_started = new Promise<void>((resolve) => {
      mark_terminal_publish_started = resolve;
    });
    const terminal_publish = new Promise<void>((resolve) => {
      release_terminal_publish = resolve;
    });
    runtime.subscribe(async (snapshot) => {
      if (snapshot.status === "done") {
        mark_terminal_publish_started();
        await terminal_publish;
      }
    });
    const handle = await runtime.begin("analysis");
    let release_completion: () => void = () => undefined;
    const completion = new Promise<void>((resolve) => {
      release_completion = resolve;
    });
    runtime.bind_completion(handle, completion);

    const finishing = runtime.finish(handle, "done");
    await terminal_publish_started;
    let dispose_completed = false;
    const disposing = runtime.dispose().then(() => {
      dispose_completed = true;
    });
    await Promise.resolve();

    expect(dispose_completed).toBe(false);
    release_terminal_publish();
    await finishing;
    expect(dispose_completed).toBe(false);

    release_completion();
    await disposing;
    expect(dispose_completed).toBe(true);
  });

  it("终态先冲刷请求压力，再归零状态并释放运行锁", async () => {
    vi.useFakeTimers();
    const runtime = create_empty_runtime();
    const snapshots: TaskSnapshot[] = [];
    runtime.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    const handle = await runtime.begin("translation");
    snapshots.length = 0;

    runtime.change_request_in_flight_count(handle, 3);
    await runtime.finish(handle, "done");

    expect(
      snapshots.map((snapshot) => ({
        status: snapshot.status,
        busy: snapshot.busy,
        request_in_flight_count: snapshot.request_in_flight_count,
      })),
    ).toEqual([
      { status: "requested", busy: true, request_in_flight_count: 3 },
      { status: "done", busy: false, request_in_flight_count: 0 },
    ]);
    expect((await runtime.build_snapshot({ task_type: "translation" })).busy).toBe(false);
    await expect(runtime.begin("analysis")).resolves.toMatchObject({
      task_type: "analysis",
    });
  });

  it("listener 拒绝启动快照时恢复状态并释放运行锁", async () => {
    const runtime = create_empty_runtime();
    const unsubscribe = runtime.subscribe((snapshot) => {
      if (snapshot.status === "requested") {
        throw new Error("listener failed");
      }
    });

    await expect(runtime.begin("translation")).rejects.toThrow("listener failed");

    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      status: "idle",
      busy: false,
    });
    unsubscribe();
    await expect(runtime.begin("analysis")).resolves.toMatchObject({
      task_type: "analysis",
    });
  });

  it("快照构造失败时仍恢复启动前状态并释放运行锁", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/broken.lg");
    const runtime_gate = new RuntimeOperationGate();
    const runtime = new TaskRuntime(
      session_state,
      {
        get_all_meta: () => {
          throw new Error("snapshot failed");
        },
      } as unknown as ProjectDataReader,
      runtime_gate,
    );
    runtime.subscribe(() => undefined);

    await expect(runtime.begin("translation")).rejects.toThrow(
      "Task startup and recovery snapshot publication both failed.",
    );

    expect(runtime_gate.get_snapshot().owner).toBeNull();
    await expect(runtime.begin("analysis")).rejects.not.toThrow("runtime.busy");
  });

  it("终态 listener 失败也先释放运行锁并允许下一轮启动", async () => {
    const runtime = create_empty_runtime();
    const unsubscribe = runtime.subscribe((snapshot) => {
      if (snapshot.status === "done") {
        throw new Error("terminal listener failed");
      }
    });
    const handle = await runtime.begin("translation");

    await expect(runtime.finish(handle, "done")).rejects.toThrow("terminal listener failed");

    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      status: "done",
      busy: false,
    });
    unsubscribe();
    await expect(runtime.begin("analysis")).resolves.toMatchObject({
      task_type: "analysis",
    });
  });

  it("终态快照构造失败也先释放运行锁并允许下一轮启动", async () => {
    let snapshot_failed = false;
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/terminal-snapshot.lg");
    const runtime = new TaskRuntime(
      session_state,
      {
        get_all_meta: () => {
          if (snapshot_failed) {
            throw new Error("terminal snapshot failed");
          }
          return {};
        },
      } as unknown as ProjectDataReader,
      new RuntimeOperationGate(),
    );
    runtime.subscribe(() => undefined);
    const handle = await runtime.begin("translation");
    snapshot_failed = true;

    await expect(runtime.finish(handle, "done")).rejects.toThrow("terminal snapshot failed");

    snapshot_failed = false;
    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      status: "done",
      busy: false,
    });
    await expect(runtime.begin("analysis")).resolves.toMatchObject({
      task_type: "analysis",
    });
  });

  it("只按存储返回的已提交 id 收缩重翻范围", async () => {
    const runtime = create_empty_runtime();
    const handle = await runtime.begin("translation", {
      kind: "items",
      item_ids: [1, 2, 3],
    });

    await runtime.publish_progress(handle, [2, 3.8, -1]);
    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      extras: { kind: "translation", scope: { kind: "items", item_ids: [1, 3] } },
    });

    await runtime.publish_progress(handle, [1, 3]);
    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      extras: { kind: "translation", scope: { kind: "items", item_ids: [] } },
    });
    await runtime.finish(handle, "done");
  });

  it("停止请求只命中同类型当前任务并传播取消", async () => {
    const runtime = create_empty_runtime();
    const handle = await runtime.begin("translation");

    await expect(runtime.request_stop("analysis")).resolves.toBe(false);
    await expect(runtime.request_stop("translation")).resolves.toBe(true);

    expect(handle.signal.aborted).toBe(true);
    await expect(runtime.build_snapshot({ task_type: "translation" })).resolves.toMatchObject({
      status: "stopping",
      busy: true,
    });
    await runtime.finish(handle, "idle");
  });

  function create_empty_runtime(): TaskRuntime {
    return new TaskRuntime(
      new ProjectSessionState(),
      {} as unknown as ProjectDataReader,
      new RuntimeOperationGate(),
    );
  }

  function create_project_database(): {
    database: ProjectDatabase;
    project_path: string;
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-task-runtime-"));
    const project_path = path.join(directory, "task.lg");
    const database = new ProjectDatabase();
    database.create_project(project_path, "task");
    cleanup_callbacks.push(() => fs.rmSync(directory, { force: true, recursive: true }));
    cleanup_callbacks.push(() => database.close());
    return { database, project_path };
  }

  function seed_project(database: ProjectDatabase, project_path: string): void {
    database.transaction(project_path, () => {
      database.set_items(project_path, [
        create_project_item({ id: 101, src: "原文", status: "NONE" }),
        create_project_item({ id: 102, src: "失败", status: "NONE" }),
        create_project_item({ id: 103, src: "跳过", status: "EXCLUDED" }),
      ]);
      database.upsert_meta_entries(project_path, {
        translation_extras: { line: 5, total_line: 10, total_tokens: 42 },
        analysis_extras: {
          total_line: 9,
          line: 4,
          processed_line: 4,
          error_line: 0,
          total_tokens: 12,
        },
        analysis_candidate_count: 3,
      });
    });
  }

  function create_project_item(
    overrides: Partial<Record<string, string | number | boolean | null>>,
  ): Record<string, string | number | boolean | null> {
    const id = Number(overrides["id"] ?? 1);
    return {
      id,
      src: "",
      dst: "",
      name_src: null,
      name_dst: null,
      extra_field: "",
      tag: "",
      row: id,
      file_type: "TXT",
      file_path: "script.txt",
      text_type: "NONE",
      status: "NONE",
      retry_count: 0,
      skip_internal_filter: false,
      ...overrides,
    };
  }
});
