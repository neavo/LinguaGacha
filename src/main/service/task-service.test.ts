import { describe, expect, it } from "vitest";

import type { SettingService } from "./setting-service";
import type { TaskEngine } from "../engine/core/engine";
import { ProjectSessionState } from "../project/project-session-state";
import type { TaskRuntimePublisher } from "../engine/runtime/task-runtime-publisher";
import type { TaskSnapshotBuilder } from "../engine/runtime/task-snapshot-builder";
import { TaskService } from "./task-service";

describe("TaskService", () => {
  it("启动重翻前校验 revision，并把去重条目交给内部 Engine bridge", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const service = new TaskService(
      {
        start: async (command: Record<string, unknown>) => {
          calls.push(command);
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({
        items: 7,
        proofreading: 2,
        quality: 3,
        prompts: 4,
      }),
      create_task_runtime_publisher(),
      session_state,
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    const result = await service.start_task({
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [2, "1", 2] },
      expected_section_revisions: { items: 7, proofreading: 2, quality: 3, prompts: 4 },
    });

    expect(calls).toEqual([
      {
        task_type: "translation",
        mode: "new",
        scope: { kind: "items", item_ids: [2, 1] },
        expected_section_revisions: { items: 7, proofreading: 2, quality: 3, prompts: 4 },
      },
    ]);
    expect(result).toEqual({
      accepted: true,
      task: {
        task_type: "translation",
        status: "requested",
        busy: true,
      },
    });
  });

  it("单条翻译在没有激活模型时直接返回 NO_ACTIVE_MODEL", async () => {
    let called = false;
    const service = new TaskService(
      {
        translate_single: async () => {
          called = true;
          return { success: true, status: "OK", dst: "译文" };
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({}),
      create_task_runtime_publisher(),
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "", models: [] }),
    );

    const result = await service.translate_single({ text: "原文" });

    expect(result).toEqual({ success: false, status: "NO_ACTIVE_MODEL", dst: "" });
    expect(called).toBe(false);
  });

  it("单条翻译在激活模型失效但仍有模型时沿用首个模型", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = new TaskService(
      {
        translate_single: async (text: string) => {
          calls.push({ text });
          return { success: true, status: "OK", dst: "译文" };
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({}),
      create_task_runtime_publisher(),
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "missing", models: [{ id: "model-1" }] }),
    );

    const result = await service.translate_single({ text: " 原文 " });

    expect(result).toEqual({ success: true, status: "OK", dst: "译文" });
    expect(calls).toEqual([{ text: "原文" }]);
  });

  it("revision 冲突时拒绝启动重翻", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const service = new TaskService(
      {} as unknown as TaskEngine,
      create_snapshot_builder({ items: 8, proofreading: 2, quality: 1, prompts: 1 }),
      create_task_runtime_publisher(),
      session_state,
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    await expect(
      service.start_task({
        task_type: "translation",
        mode: "new",
        scope: { kind: "items", item_ids: [1] },
        expected_section_revisions: { items: 7, proofreading: 2, quality: 1, prompts: 1 },
      }),
    ).rejects.toThrow("运行态 revision 冲突");
  });

  it("任务启动缺少 expected_section_revisions 或必需 section 时拒绝执行", async () => {
    const calls: string[] = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const service = new TaskService(
      {
        start: async () => {
          calls.push("start");
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({ quality: 1, prompts: 2 }),
      create_task_runtime_publisher(),
      session_state,
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    await expect(service.start_task({ task_type: "translation", mode: "new" })).rejects.toThrow(
      "任务启动缺少 expected_section_revisions",
    );
    await expect(
      service.start_task({
        task_type: "translation",
        mode: "new",
        expected_section_revisions: { quality: 1 },
      }),
    ).rejects.toThrow("任务启动缺少 prompts revision");
    expect(calls).toEqual([]);
  });

  function create_snapshot_builder(revisions: Record<string, number>): TaskSnapshotBuilder {
    return {
      build_command_ack: async (
        task_type: string,
        status: string,
        busy: boolean,
        overrides?: Record<string, unknown>,
      ) => ({
        task_type,
        status,
        busy,
        ...overrides,
      }),
      get_runtime_section_revision: (section: string) => revisions[section] ?? 0,
    } as unknown as TaskSnapshotBuilder;
  }

  function create_task_runtime_publisher(): TaskRuntimePublisher {
    return {
      begin_task: async () => undefined,
      mark_stopping: async () => undefined,
      restore: async () => undefined,
      snapshot_state: () => ({
        active_task_type: "idle",
        busy: false,
        request_in_flight_count: 0,
        translation_scope: { kind: "all" },
        status: "idle",
      }),
    } as unknown as TaskRuntimePublisher;
  }

  function create_setting_service(config: Record<string, unknown>): SettingService {
    return {
      load_setting: () => config,
    } as unknown as SettingService;
  }
});
