import { describe, expect, it } from "vitest";

import type { AppSettingService } from "../app/app-setting-service";
import type { TaskEngine } from "../engine/core/engine";
import { TaskRuntimeState } from "../engine/runtime/task-runtime-state";
import { ProjectOperationGate } from "../project/project-operation-gate";
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
      create_project_operation_gate(),
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

  it("启动分析任务只校验质量和提示词 revision", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const begin_records: Array<Record<string, unknown>> = [];
    const service = new TaskService(
      {
        start: async (command: Record<string, unknown>) => {
          calls.push(command);
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({ quality: 5, prompts: 6 }),
      create_task_runtime_publisher({ begin_records }),
      create_project_operation_gate(),
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    const result = await service.start_task({
      task_type: "analysis",
      mode: "CONTINUE",
      expected_section_revisions: { quality: 5, prompts: 6, items: 404 },
    });

    expect(calls).toEqual([
      {
        task_type: "analysis",
        mode: "continue",
        expected_section_revisions: { quality: 5, prompts: 6, items: 404 },
      },
    ]);
    expect(begin_records).toEqual([{ task_type: "analysis", scope: { kind: "all" } }]);
    expect(result).toEqual({
      accepted: true,
      task: {
        task_type: "analysis",
        status: "requested",
        busy: true,
      },
    });
  });

  it("Engine 启动失败时恢复此前任务运行态并继续抛出错误", async () => {
    const previous_state = {
      active_task_type: "translation",
      busy: true,
      request_in_flight_count: 2,
      status: "running",
      translation_scope: { kind: "items", item_ids: [9] },
    };
    const restored_states: unknown[] = [];
    const service = new TaskService(
      {
        start: async () => {
          throw new Error("engine failed");
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({ quality: 1, prompts: 2 }),
      create_task_runtime_publisher({ previous_state, restored_states }),
      create_project_operation_gate(),
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    await expect(
      service.start_task({
        task_type: "translation",
        mode: "new",
        scope: { kind: "all" },
        expected_section_revisions: { quality: 1, prompts: 2 },
      }),
    ).rejects.toThrow("engine failed");

    expect(restored_states).toEqual([previous_state]);
  });

  it("结构性项目 mutation 正在运行时拒绝启动任务", async () => {
    const calls: string[] = [];
    const project_operation_gate = create_project_operation_gate();
    let release_mutation = (): void => {
      throw new Error("mutation lease 尚未建立");
    };
    const running_mutation = project_operation_gate.run_exclusive_project_mutation(
      async () =>
        new Promise<void>((resolve) => {
          release_mutation = resolve;
        }),
    );
    const service = new TaskService(
      {
        start: async () => {
          calls.push("start");
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({ quality: 1, prompts: 2 }),
      create_task_runtime_publisher(),
      project_operation_gate,
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    await expect(
      service.start_task({
        task_type: "analysis",
        mode: "new",
        expected_section_revisions: { quality: 1, prompts: 2 },
      }),
    ).rejects.toThrow("task.busy");

    expect(calls).toEqual([]);
    release_mutation();
    await running_mutation;
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
      create_project_operation_gate(),
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "", models: [] }),
    );

    const result = await service.translate_single({ text: "原文" });

    expect(result).toEqual({ success: false, status: "NO_ACTIVE_MODEL", dst: "" });
    expect(called).toBe(false);
  });

  it("停止回包晚于终态时返回当前真实快照", async () => {
    let snapshot_status = "stopping";
    let snapshot_busy = true;
    const service = new TaskService(
      {
        stop: async () => {
          snapshot_status = "idle";
          snapshot_busy = false;
          return true;
        },
      } as unknown as TaskEngine,
      create_snapshot_builder({}, () => ({
        task_type: "translation",
        status: snapshot_status,
        busy: snapshot_busy,
      })),
      create_task_runtime_publisher(),
      create_project_operation_gate(),
      new ProjectSessionState(),
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    const result = await service.stop_task({ task_type: "translation" });

    expect(result).toEqual({
      accepted: true,
      task: {
        task_type: "translation",
        status: "idle",
        busy: false,
      },
    });
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
      create_project_operation_gate(),
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
      create_project_operation_gate(),
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
    ).rejects.toThrow("data.revision_conflict");
  });

  it("request.validation_failed 或必需 section 时拒绝执行", async () => {
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
      create_project_operation_gate(),
      session_state,
      create_setting_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    await expect(service.start_task({ task_type: "translation", mode: "new" })).rejects.toThrow(
      "request.validation_failed",
    );
    await expect(
      service.start_task({
        task_type: "translation",
        mode: "new",
        expected_section_revisions: { quality: 1 },
      }),
    ).rejects.toThrow("request.validation_failed");
    expect(calls).toEqual([]);
  });

  function create_snapshot_builder(
    revisions: Record<string, number>,
    build_task_snapshot: () => Record<string, unknown> = () => ({
      task_type: "translation",
      status: "idle",
      busy: false,
    }),
  ): TaskSnapshotBuilder {
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
      build_task_snapshot: async () => build_task_snapshot(),
      get_runtime_section_revision: (section: string) => revisions[section] ?? 0,
    } as unknown as TaskSnapshotBuilder;
  }

  function create_task_runtime_publisher(
    options: {
      begin_records?: Array<Record<string, unknown>>;
      previous_state?: Record<string, unknown>;
      restored_states?: unknown[];
    } = {},
  ): TaskRuntimePublisher {
    const previous_state = options.previous_state ?? {
      active_task_type: "idle",
      busy: false,
      request_in_flight_count: 0,
      translation_scope: { kind: "all" },
      status: "idle",
    };
    return {
      begin_task: async (task_type: string, scope: Record<string, unknown>) => {
        options.begin_records?.push({ task_type, scope });
      },
      restore: async (state: unknown) => {
        options.restored_states?.push(state);
      },
      snapshot_state: () => previous_state,
    } as unknown as TaskRuntimePublisher;
  }

  /**
   * 每个 TaskService 用例持有独立互斥门闩，避免跨用例运行态残留。
   */
  function create_project_operation_gate(): ProjectOperationGate {
    return new ProjectOperationGate(new TaskRuntimeState());
  }

  function create_setting_service(config: Record<string, unknown>): AppSettingService {
    return {
      read_setting: () => config,
    } as unknown as AppSettingService;
  }
});
