import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { TaskRuntimeState } from "../task/task-runtime-state";
import { ProjectSyncMutationService } from "./project-sync-mutation-service";
import { ProjectSessionState } from "./project-session-state";

let temp_dir = "";

/**
 * 所有临时工程路径都落在本用例目录下，避免误碰用户项目文件。
 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

/**
 * 为每个用例创建独立 .lg 和服务实例，避免 revision / asset 顺序互相污染。
 */
function create_service(): {
  database: ProjectDatabase;
  service: ProjectSyncMutationService;
  task_runtime_state: TaskRuntimeState;
  lg_path: string;
} {
  const database = new ProjectDatabase();
  const task_runtime_state = new TaskRuntimeState();
  const session_state = new ProjectSessionState();
  const lg_path = project_path("demo.lg");
  database.execute({
    name: "createProject",
    args: { projectPath: lg_path, name: "demo" },
  });
  session_state.mark_loaded(lg_path);
  return {
    database,
    service: new ProjectSyncMutationService(database, task_runtime_state, session_state),
    task_runtime_state,
    lg_path,
  };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-service-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectSyncMutationService", () => {
  it("写入 settings-only 对齐结果且不 bump 运行态 section", async () => {
    const { database, service, lg_path } = create_service();

    const ack = await service.apply_settings_alignment({
      mode: "settings_only",
      project_settings: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
    });

    expect(ack).toEqual({ accepted: true, projectRevision: 0, sectionRevisions: {} });
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "source_language", default: "" },
      }),
    ).toBe("JA");
    database.close();
  });

  it("显式 path 不存在时拒绝 settings-only 对齐且不创建空工程库", async () => {
    const { database, service } = create_service();
    const missing_path = project_path("missing.lg");

    await expect(
      service.apply_settings_alignment({
        path: missing_path,
        mode: "settings_only",
        project_settings: {
          source_language: "JA",
          target_language: "ZH",
        },
      }),
    ).rejects.toThrow("工程文件不存在");

    expect(fs.existsSync(missing_path)).toBe(false);
    database.close();
  });

  it("提交 translation reset all 时替换 items 并清分析事实", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "旧", dst: "old", status: "PROCESSED" }],
      },
    });
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
          {
            src: "旧",
            dst_votes: {},
            info_votes: {},
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: false,
          },
        ],
      },
    });

    const ack = await service.apply_translation_reset({
      mode: "all",
      items: [{ id: 1, src: "新", dst: "", status: "NONE", row: 1 }],
      translation_extras: { line: 0 },
      prefilter_config: { source_language: "JA" },
      expected_section_revisions: { items: 0, analysis: 0 },
    });

    expect(ack).toEqual({
      accepted: true,
      projectRevision: 1,
      sectionRevisions: { items: 1, analysis: 1 },
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "新", dst: "", status: "NONE", row: 1, retry_count: 0 },
    ]);
    expect(
      database.execute({
        name: "getAnalysisCandidateAggregates",
        args: { projectPath: lg_path },
      }),
    ).toEqual([]);
    database.close();
  });

  it("按完整文件集合重排 assets 并只 bump files section", async () => {
    const { database, service, lg_path } = create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: first_source, sortOrder: 0 },
    });
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "b.txt", sourcePath: second_source, sortOrder: 1 },
    });

    const ack = await service.reorder_workbench_files({
      ordered_rel_paths: ["b.txt", "a.txt"],
      expected_section_revisions: { files: 0 },
    });

    expect(ack).toEqual({
      accepted: true,
      projectRevision: 1,
      sectionRevisions: { files: 1 },
    });
    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
    database.close();
  });

  it("工作台 reset-file 兼容 derived_meta 并只写白名单 meta", async () => {
    const { database, service, lg_path } = create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: source_path, sortOrder: 0 },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "旧", dst: "old", file_path: "a.txt", status: "PROCESSED" }],
      },
    });

    await service.reset_workbench_file({
      rel_paths: ["a.txt"],
      items: [{ id: 1, dst: "", status: "NONE" }],
      derived_meta: {
        translation_extras: { line: 3 },
        prefilter_config: { source_language: "JA" },
      },
      expected_section_revisions: { items: 0, analysis: 0 },
    });

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: {} },
      }),
    ).toEqual({ line: 3 });
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "prefilter_config", default: {} },
      }),
    ).toEqual({ source_language: "JA" });
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "derived_meta", default: null },
      }),
    ).toBeNull();
    database.close();
  });

  it("任务忙碌时拒绝 translation reset 且不写库", async () => {
    const { database, service, task_runtime_state, lg_path } = create_service();
    task_runtime_state.begin_task("translation");
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [{ id: 1, src: "旧", dst: "old", status: "PROCESSED" }],
      },
    });

    await expect(
      service.apply_translation_reset({
        mode: "all",
        items: [{ id: 1, src: "新", dst: "", status: "NONE" }],
        expected_section_revisions: { items: 0, analysis: 0 },
      }),
    ).rejects.toThrow("任务正在执行中");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "旧", dst: "old", status: "PROCESSED" },
    ]);
    database.close();
  });

  it("任务忙碌时拒绝 analysis reset 且不写 analysis meta", async () => {
    const { database, service, task_runtime_state, lg_path } = create_service();
    task_runtime_state.begin_task("analysis");

    await expect(
      service.apply_analysis_reset({
        mode: "all",
        analysis_extras: { line: 1 },
        expected_section_revisions: { analysis: 0 },
      }),
    ).rejects.toThrow("任务正在执行中");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "analysis_extras", default: null },
      }),
    ).toBeNull();
    database.close();
  });

  it("任务忙碌时拒绝工作台文件 mutation 且不写库", async () => {
    const { database, service, task_runtime_state, lg_path } = create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: first_source, sortOrder: 0 },
    });
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "b.txt", sourcePath: second_source, sortOrder: 1 },
    });
    task_runtime_state.begin_task("translation");

    await expect(
      service.reorder_workbench_files({
        ordered_rel_paths: ["b.txt", "a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow("任务正在执行中");

    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    database.close();
  });

  it("工作台 mutation 中途失败时仍释放文件 guard", async () => {
    const { database, service, lg_path } = create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: source_path, sortOrder: 0 },
    });
    const original_execute_transaction = database.execute_transaction.bind(database);
    database.execute_transaction = (): null => {
      throw new Error("事务失败");
    };

    await expect(
      service.reorder_workbench_files({
        ordered_rel_paths: ["a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow("事务失败");

    database.execute_transaction = original_execute_transaction;
    await expect(
      service.reorder_workbench_files({
        ordered_rel_paths: ["a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).resolves.toEqual({
      accepted: true,
      projectRevision: 1,
      sectionRevisions: { files: 1 },
    });
    database.close();
  });

  it("revision 冲突时拒绝写入并不触发 runtime sync", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 2 },
    });

    await expect(
      service.apply_translation_reset({
        mode: "failed",
        items: [],
        translation_extras: {},
        expected_section_revisions: { items: 1 },
      }),
    ).rejects.toThrow("items section revision 冲突");
    database.close();
  });
});
