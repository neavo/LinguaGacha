import { describe, expect, it } from "vitest";

import type { CoreBridgeClient } from "../core/core-bridge-client";
import type { ConfigService } from "../service/config-service";
import { ProjectSessionState } from "../project/project-session-state";
import type { TaskSnapshotBuilder } from "./task-snapshot-builder";
import { TaskService } from "./task-service";

describe("TaskService", () => {
  it("启动重翻前校验 revision，并把去重条目交给内部 Engine bridge", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const service = new TaskService(
      {
        start_retranslate: async (body: Record<string, unknown>) => {
          calls.push(body);
        },
      } as unknown as CoreBridgeClient,
      create_snapshot_builder({
        items: 7,
        proofreading: 2,
      }),
      session_state,
      create_config_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    const result = await service.start_retranslate({
      item_ids: [2, "1", 2],
      expected_section_revisions: { items: 7, proofreading: 2 },
    });

    expect(calls).toEqual([{ item_ids: [2, 1] }]);
    expect(result).toEqual({
      accepted: true,
      task: {
        task_type: "retranslate",
        status: "REQUEST",
        busy: true,
        retranslating_item_ids: [2, 1],
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
      } as unknown as CoreBridgeClient,
      create_snapshot_builder({}),
      new ProjectSessionState(),
      create_config_service({ activate_model_id: "", models: [] }),
    );

    const result = await service.translate_single({ text: "原文" });

    expect(result).toEqual({ success: false, status: "NO_ACTIVE_MODEL", dst: "" });
    expect(called).toBe(false);
  });

  it("单条翻译在激活模型失效但仍有模型时沿用首个模型", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const service = new TaskService(
      {
        translate_single: async (body: Record<string, unknown>) => {
          calls.push(body);
          return { success: true, status: "OK", dst: "译文" };
        },
      } as unknown as CoreBridgeClient,
      create_snapshot_builder({}),
      new ProjectSessionState(),
      create_config_service({ activate_model_id: "missing", models: [{ id: "model-1" }] }),
    );

    const result = await service.translate_single({ text: " 原文 " });

    expect(result).toEqual({ success: true, status: "OK", dst: "译文" });
    expect(calls).toEqual([{ text: "原文" }]);
  });

  it("revision 冲突时拒绝启动重翻", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const service = new TaskService(
      {} as unknown as CoreBridgeClient,
      create_snapshot_builder({ items: 8, proofreading: 2 }),
      session_state,
      create_config_service({ activate_model_id: "model-1", models: [{ id: "model-1" }] }),
    );

    await expect(
      service.start_retranslate({
        item_ids: [1],
        expected_section_revisions: { items: 7 },
      }),
    ).rejects.toThrow("运行态 revision 冲突");
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

  function create_config_service(config: Record<string, unknown>): ConfigService {
    return {
      load_config: () => config,
    } as unknown as ConfigService;
  }
});
