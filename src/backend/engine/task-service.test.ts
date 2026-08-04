import { describe, expect, it } from "vitest";

import type { TaskEngine } from "./core/engine";
import { TaskService } from "./task-service";
import { TaskRuntime } from "./task-runtime";
import type { ProjectDataReader } from "../project/project-data-reader";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectSessionState } from "../project/project-session-state";
import type { JsonRecord } from "../../domain/json";

describe("TaskService", () => {
  it("启动重翻前校验 revision，并把去重条目和运行句柄交给 Engine", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime(
      { items: 7, proofreading: 2, quality: 3, prompts: 4 },
      session_state,
    );
    const service = create_service(
      {
        start: async (_handle: unknown, command: Record<string, unknown>) => {
          calls.push(command);
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    const result = await service.start_task({
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [2, "1", 2] },
      expected_section_revisions: {
        items: 7,
        proofreading: 2,
        quality: 3,
        prompts: 4,
      },
    });

    expect(calls).toEqual([
      {
        task_type: "translation",
        mode: "new",
        scope: { kind: "items", item_ids: [2, 1] },
        expected_section_revisions: {
          items: 7,
          proofreading: 2,
          quality: 3,
          prompts: 4,
        },
      },
    ]);
    expect(result).toMatchObject({
      accepted: true,
      task: {
        task_type: "translation",
        status: "requested",
        busy: true,
        extras: {
          kind: "translation",
          scope: { kind: "items", item_ids: [2, 1] },
        },
      },
    });
  });

  it("启动分析任务只校验质量和提示词 revision", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const snapshots: Array<Record<string, unknown>> = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime({ quality: 5, prompts: 6 }, session_state);
    runtime.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    const service = create_service(
      {
        start: async (_handle: unknown, command: Record<string, unknown>) => {
          calls.push(command);
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
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
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      task_type: "analysis",
      status: "requested",
      busy: true,
    });
    expect(result).toMatchObject({
      accepted: true,
      task: {
        task_type: "analysis",
        status: "requested",
        busy: true,
      },
    });
  });

  it("current-project 重翻入口补全 required-section revision", async () => {
    const revisions = { items: 7, proofreading: 2, quality: 3, prompts: 4 };
    const sections: string[] = [];
    const commands: Array<Record<string, unknown>> = [];
    const session = new ProjectSessionState();
    session.mark_loaded("E:/Project/current.lg");
    const runtime = create_runtime(revisions, session, sections);
    const service = create_service(
      {
        start: async (_handle: unknown, command: Record<string, unknown>) => {
          commands.push(command);
        },
      } as unknown as TaskEngine,
      runtime,
      session,
    );

    const snapshot = await service.start_current_project_task({
      task_type: "translation",
      mode: "new",
      scope: { kind: "items", item_ids: [2, 1] },
    });

    expect(sections).toEqual(["items", "proofreading", "quality", "prompts"]);
    expect(commands[0]).toMatchObject({
      expected_section_revisions: revisions,
      scope: { kind: "items", item_ids: [2, 1] },
    });
    expect(snapshot).toMatchObject({
      task_type: "translation",
      status: "requested",
      busy: true,
    });
  });

  it("启动回包晚于瞬时终态时返回当前真实快照", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime({ quality: 1, prompts: 2 }, session_state);
    const service = create_service(
      {
        start: async (handle: Parameters<TaskEngine["start"]>[0]) => {
          await runtime.finish(handle, "done");
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    const result = await service.start_task({
      task_type: "translation",
      mode: "new",
      scope: { kind: "all" },
      expected_section_revisions: { quality: 1, prompts: 2 },
    });

    expect(result).toMatchObject({
      accepted: true,
      task: {
        task_type: "translation",
        status: "done",
        busy: false,
      },
    });
  });

  it("Engine 启动失败且恢复 listener 失败时仍释放运行锁", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime({ quality: 1, prompts: 2 }, session_state);
    runtime.subscribe((snapshot) => {
      if (snapshot.status === "idle") {
        throw new Error("restore listener failed");
      }
    });
    const service = create_service(
      {
        start: async () => {
          throw new Error("engine failed");
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    await expect(
      service.start_task({
        task_type: "translation",
        mode: "new",
        scope: { kind: "all" },
        expected_section_revisions: { quality: 1, prompts: 2 },
      }),
    ).rejects.toThrow("任务启动失败且恢复快照发布失败");

    expect((await runtime.build_snapshot({ task_type: "translation" })).busy).toBe(false);
    await expect(runtime.begin("analysis")).resolves.toMatchObject({ task_type: "analysis" });
  });

  it("结构性项目 write 正在运行时拒绝启动任务", async () => {
    const calls: string[] = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime_gate = new RuntimeOperationGate();
    const runtime = create_runtime({ quality: 1, prompts: 2 }, session_state, [], {}, runtime_gate);
    let release_write = (): void => {
      throw new Error("写入租约尚未建立");
    };
    const running_write = runtime_gate.run_project_write(
      async () =>
        new Promise<void>((resolve) => {
          release_write = resolve;
        }),
    );
    const service = new TaskService(
      {
        start: async () => {
          calls.push("start");
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    await expect(
      service.start_task({
        task_type: "analysis",
        mode: "new",
        expected_section_revisions: { quality: 1, prompts: 2 },
      }),
    ).rejects.toThrow("runtime.busy");

    expect(calls).toEqual([]);
    release_write();
    await running_write;
  });

  it("未加载工程时统一拒绝翻译、重翻与分析启动", async () => {
    const calls: string[] = [];
    const session_state = new ProjectSessionState();
    const runtime = create_runtime(
      { items: 1, proofreading: 1, quality: 1, prompts: 1 },
      session_state,
    );
    const service = create_service(
      {
        start: async () => {
          calls.push("start");
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    const requests: JsonRecord[] = [
      {
        task_type: "translation",
        mode: "new",
        scope: { kind: "all" },
        expected_section_revisions: { quality: 1, prompts: 1 },
      },
      {
        task_type: "translation",
        mode: "new",
        scope: { kind: "items", item_ids: [1] },
        expected_section_revisions: {
          items: 1,
          proofreading: 1,
          quality: 1,
          prompts: 1,
        },
      },
      {
        task_type: "analysis",
        mode: "new",
        expected_section_revisions: { quality: 1, prompts: 1 },
      },
    ];
    for (const request of requests) {
      await expect(service.start_task(request)).rejects.toThrow("project.not_loaded");
    }

    expect(calls).toEqual([]);
    expect((await runtime.build_snapshot({ task_type: "translation" })).busy).toBe(false);
  });

  it("停止回包晚于终态时返回当前真实快照", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime({}, session_state, [], {
      translation_extras: {
        line: 5,
        total_line: 5,
        processed_line: 5,
      },
    });
    const handle = await runtime.begin("analysis");
    const service = create_service(
      {
        stop: async () => {
          await runtime.request_stop("analysis");
          await runtime.finish(handle, "idle");
          return true;
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    const result = await service.stop_task({ task_type: "analysis" });

    expect(result).toMatchObject({
      accepted: true,
      task: {
        task_type: "analysis",
        status: "idle",
        busy: false,
      },
    });
  });

  it("停止类型未命中时返回 accepted false 和真实活动快照", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime({}, session_state);
    await runtime.begin("translation");
    const service = create_service(
      {
        stop: async (command: Parameters<TaskEngine["stop"]>[0]) =>
          await runtime.request_stop(command.task_type),
      } as unknown as TaskEngine,
      runtime,
      session_state,
    );

    const result = await service.stop_task({ task_type: "analysis" });

    expect(result).toMatchObject({
      accepted: false,
      task: {
        task_type: "translation",
        status: "requested",
        busy: true,
      },
    });
  });

  it("revision 冲突时拒绝启动重翻", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime(
      { items: 8, proofreading: 2, quality: 1, prompts: 1 },
      session_state,
    );
    const service = create_service({} as TaskEngine, runtime, session_state);

    await expect(
      service.start_task({
        task_type: "translation",
        mode: "new",
        scope: { kind: "items", item_ids: [1] },
        expected_section_revisions: {
          items: 7,
          proofreading: 2,
          quality: 1,
          prompts: 1,
        },
      }),
    ).rejects.toThrow("data.revision_conflict");
  });

  it("请求字段非法或缺少必需 section 时拒绝执行", async () => {
    const calls: string[] = [];
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const runtime = create_runtime({ quality: 1, prompts: 2 }, session_state);
    const service = create_service(
      {
        start: async () => {
          calls.push("start");
        },
      } as unknown as TaskEngine,
      runtime,
      session_state,
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

  function create_runtime(
    revisions: Record<string, number>,
    session_state: ProjectSessionState,
    read_sections: string[] = [],
    meta: JsonRecord = {},
    runtime_gate = new RuntimeOperationGate(),
  ): TaskRuntime {
    return new TaskRuntime(
      session_state,
      {
        get_all_meta: () => meta,
        get_section_revision: (_meta: unknown, section: string) => {
          read_sections.push(section);
          return revisions[section] ?? 0;
        },
      } as unknown as ProjectDataReader,
      runtime_gate,
    );
  }

  function create_service(
    task_engine: TaskEngine,
    runtime: TaskRuntime,
    session_state: ProjectSessionState,
  ): TaskService {
    return new TaskService(task_engine, runtime, session_state);
  }
});
