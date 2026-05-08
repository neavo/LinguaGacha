import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import type { ProjectStatePayload } from "../core/core-bridge-client";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectService } from "./project-service";

let temp_dir = "";

class FakeCoreBridge {
  public state: ProjectStatePayload = { loaded: true, projectPath: "", busy: false };
  public begin_error: Error | null = null;
  public begin_calls = 0;
  public end_calls = 0;
  public sync_calls: Array<{ type: string; payload: Record<string, ApiJsonValue> }> = [];

  /**
   * 返回测试工程状态，模拟 TS Gateway 内部 runtime bridge。
   */
  public async get_project_state(): Promise<ProjectStatePayload> {
    return this.state;
  }

  /**
   * 记录缓存同步调用，便于断言 TS 写库后会通知 Python Core。
   */
  public async sync_runtime(type: string, payload: Record<string, ApiJsonValue>): Promise<void> {
    this.sync_calls.push({ type, payload });
  }

  /**
   * 模拟 Python Core 文件操作锁，验证工作台 mutation 的互斥边界。
   */
  public async begin_project_file_operation(): Promise<void> {
    if (this.begin_error !== null) {
      throw this.begin_error;
    }
    this.begin_calls += 1;
  }

  /**
   * 记录文件操作锁释放，确保异常路径也能退出临界区。
   */
  public async finish_project_file_operation(): Promise<void> {
    this.end_calls += 1;
  }
}

function project_path(name: string): string {
  return path.join(temp_dir, name);
}

function create_service(): {
  bridge: FakeCoreBridge;
  database: ProjectDatabase;
  service: ProjectService;
  lg_path: string;
} {
  const database = new ProjectDatabase();
  const bridge = new FakeCoreBridge();
  const lg_path = project_path("demo.lg");
  database.execute({
    name: "createProject",
    args: { projectPath: lg_path, name: "demo" },
  });
  bridge.state.projectPath = lg_path;
  return {
    bridge,
    database,
    service: new ProjectService(database, bridge as never),
    lg_path,
  };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-service-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("ProjectService", () => {
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

  it("提交 translation reset all 时替换 items、清分析事实并同步 Py 缓存", async () => {
    const { bridge, database, service, lg_path } = create_service();
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
    expect(bridge.sync_calls).toEqual([
      {
        type: "project_data_changed",
        payload: { sections: ["items", "analysis"] },
      },
    ]);
    database.close();
  });

  it("按完整文件集合重排 assets 并只 bump files section", async () => {
    const { bridge, database, service, lg_path } = create_service();
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
    expect(bridge.begin_calls).toBe(1);
    expect(bridge.end_calls).toBe(1);
    database.close();
  });

  it("工作台 reset-file 兼容 derived_meta 并只写白名单 meta", async () => {
    const { bridge, database, service, lg_path } = create_service();
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
    expect(bridge.begin_calls).toBe(1);
    expect(bridge.end_calls).toBe(1);
    database.close();
  });

  it("任务忙碌时拒绝 translation reset 且不写库", async () => {
    const { bridge, database, service, lg_path } = create_service();
    bridge.state.busy = true;
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
    expect(bridge.sync_calls).toEqual([]);
    database.close();
  });

  it("任务忙碌时拒绝 analysis reset 且不写 analysis meta", async () => {
    const { bridge, database, service, lg_path } = create_service();
    bridge.state.busy = true;

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
    expect(bridge.sync_calls).toEqual([]);
    database.close();
  });

  it("文件 guard begin 失败时不写库也不调用 end", async () => {
    const { bridge, database, service, lg_path } = create_service();
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
    bridge.begin_error = new Error("任务正在执行中 …");

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
    expect(bridge.end_calls).toBe(0);
    database.close();
  });

  it("工作台 mutation 中途失败时仍释放文件 guard", async () => {
    const { bridge, database, service, lg_path } = create_service();
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

    expect(bridge.begin_calls).toBe(1);
    expect(bridge.end_calls).toBe(1);
    database.execute_transaction = original_execute_transaction;
    database.close();
  });

  it("revision 冲突时拒绝写入并不触发 runtime sync", async () => {
    const { bridge, database, service, lg_path } = create_service();
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
    expect(bridge.sync_calls).toEqual([]);
    database.close();
  });
});
