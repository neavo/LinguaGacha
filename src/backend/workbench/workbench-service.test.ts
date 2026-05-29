import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectEventBus } from "../project/project-events";
import { ProjectDatabase } from "../database/database-operations";
import type { ApiJsonValue } from "../api/api-types";
import { TaskRunState } from "../engine/run/task-run-state";
import { FileFormatService } from "../file/file-format-service";
import type { LogManager } from "../log/log-manager";
import { ProjectOperationGate } from "../project/project-gate";
import { WorkbenchService } from "./workbench-service";
import type { ProjectChangePublisher } from "../project/project-changes";
import { ProjectMutationStore } from "../project/project-mutation-store";
import { get_section_revision } from "../project/project-data";
import { ProjectSessionState } from "../project/project-session";
import type { ProjectChangeEvent } from "../../shared/project-event";

let temp_dir = "";

/**
 * 所有临时工程路径都落在本用例目录下，避免误碰用户项目文件
 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

/**
 * 为每个用例创建独立 .lg 和服务实例，避免 revision / asset 顺序互相污染
 */
function create_service(
  project_change_publisher?: ProjectChangePublisher | null,
  log_manager: Pick<LogManager, "warning"> | null = create_log_manager(),
): {
  database: ProjectDatabase;
  service: WorkbenchService;
  task_run_state: TaskRunState;
  lg_path: string;
} {
  const database = new ProjectDatabase();
  const task_run_state = new TaskRunState();
  const session_state = new ProjectSessionState();
  const lg_path = project_path("demo.lg");
  database.execute({
    name: "createProject",
    args: { projectPath: lg_path, name: "demo" },
  });
  session_state.mark_loaded(lg_path);
  const publisher =
    project_change_publisher === undefined
      ? create_test_project_change_publisher(database, lg_path)
      : project_change_publisher;
  const project_operation_gate = new ProjectOperationGate(task_run_state);
  const project_event_bus = new ProjectEventBus();
  const mutation_store = new ProjectMutationStore(database, project_event_bus, publisher);
  return {
    database,
    service: new WorkbenchService(
      database,
      project_operation_gate,
      session_state,
      mutation_store,
      null,
      undefined,
      log_manager,
    ),
    task_run_state,
    lg_path,
  };
}

function create_log_manager(): Pick<LogManager, "warning"> {
  return {
    warning: vi.fn(),
  } as unknown as Pick<LogManager, "warning">;
}

function create_test_project_change_publisher(
  database: ProjectDatabase,
  lg_path: string,
): ProjectChangePublisher {
  return {
    publish_project_change: vi.fn((payload: Record<string, ApiJsonValue>): ProjectChangeEvent => {
      const updated_sections = Array.isArray(payload.updatedSections)
        ? payload.updatedSections.map((section) => String(section))
        : [];
      const meta = database.execute({
        name: "getAllMeta",
        args: { projectPath: lg_path },
      }) as Record<string, ApiJsonValue>;
      const section_revisions = Object.fromEntries(
        updated_sections.map((section) => [section, get_section_revision(meta, section)]),
      );
      return {
        type: "project.changed",
        eventId: `test-${String(payload.source ?? "project_change")}`,
        source: String(payload.source ?? "project_change"),
        projectPath: String(payload.targetProjectPath ?? ""),
        projectRevision: Math.max(...Object.values(section_revisions), 0),
        sectionRevisions: section_revisions,
        updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
        ...(payload.items === undefined
          ? {}
          : { items: payload.items as ProjectChangeEvent["items"] }),
        ...(payload.files === undefined
          ? {}
          : { files: payload.files as ProjectChangeEvent["files"] }),
        ...(payload.sections === undefined
          ? {}
          : { sections: payload.sections as ProjectChangeEvent["sections"] }),
      };
    }),
  } as unknown as ProjectChangePublisher;
}

function create_static_project_change_publisher(section_revisions: Record<string, number>): {
  publish_project_change: ReturnType<typeof vi.fn>;
} {
  return {
    publish_project_change: vi.fn((payload: Record<string, ApiJsonValue>): ProjectChangeEvent => {
      const updated_sections = Array.isArray(payload.updatedSections)
        ? payload.updatedSections.map((section) => String(section))
        : [];
      const current_section_revisions = Object.fromEntries(
        updated_sections.map((section) => [section, section_revisions[section] ?? 0]),
      );
      return {
        type: "project.changed",
        eventId: `test-${String(payload.source ?? "project_change")}`,
        source: String(payload.source ?? "project_change"),
        projectPath: String(payload.targetProjectPath ?? ""),
        projectRevision: Math.max(...Object.values(current_section_revisions), 0),
        sectionRevisions: current_section_revisions,
        updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
      };
    }),
  };
}

function create_public_item(
  overrides: Record<string, ApiJsonValue> = {},
): Record<string, ApiJsonValue> {
  return {
    item_id: 1,
    src: "原文",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 1,
    file_type: "TXT",
    file_path: "a.txt",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_persistent_item(
  overrides: Record<string, ApiJsonValue> = {},
): Record<string, ApiJsonValue> {
  const item = create_public_item(overrides);
  const { item_id, row_number, ...rest_item } = item;
  return {
    ...rest_item,
    id: item_id,
    row: row_number,
  };
}

/**
 * 暂停下一次格式解析，稳定复现慢准备阶段持有结构性 write lease 的窗口
 */
function pause_next_parse_asset(): {
  parse_started: Promise<void>;
  release_parse: () => void;
} {
  const original_parse_asset = FileFormatService.prototype.parse_asset;
  let mark_parse_started: () => void = () => {};
  let release_parse: () => void = () => {};
  const parse_started = new Promise<void>((resolve) => {
    mark_parse_started = resolve;
  });
  const parse_released = new Promise<void>((resolve) => {
    release_parse = resolve;
  });
  vi.spyOn(FileFormatService.prototype, "parse_asset").mockImplementationOnce(
    async function (this: FileFormatService, rel_path, content) {
      mark_parse_started();
      await parse_released;
      return original_parse_asset.call(this, rel_path, content);
    },
  );
  return { parse_started, release_parse };
}

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-project-service-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("WorkbenchService", () => {
  it("写入 settings-only 对齐结果且不 bump 运行态 section", async () => {
    const publish_project_change = vi.fn();
    const { database, service, lg_path } = create_service({
      publish_project_change,
    } as unknown as ProjectChangePublisher);

    const ack = await service.apply_settings_alignment({
      mode: "settings_only",
      project_settings: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: false,
      },
    });

    expect(ack).toEqual({ accepted: true, changes: [] });
    expect(publish_project_change).not.toHaveBeenCalled();
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
    ).rejects.toThrow("project.not_found");

    expect(fs.existsSync(missing_path)).toBe(false);
    database.close();
  });

  it("显式 path 写入未加载工程时不返回当前会话项目变更", async () => {
    const publish_project_change = vi.fn(() => null);
    const { database, service } = create_service({
      publish_project_change,
    } as unknown as ProjectChangePublisher);
    const other_lg_path = project_path("other.lg");
    database.execute({
      name: "createProject",
      args: { projectPath: other_lg_path, name: "other" },
    });

    const ack = await service.apply_settings_alignment({
      path: other_lg_path,
      mode: "prefiltered_items",
      expected_section_revisions: { items: 0, analysis: 0 },
      project_settings: {
        source_language: "JA",
        target_language: "ZH",
        mtool_optimizer_enable: false,
        skip_duplicate_source_text_enable: true,
      },
    });

    expect(ack).toEqual({ accepted: true, changes: [] });
    expect(publish_project_change).toHaveBeenCalledWith(
      expect.objectContaining({
        targetProjectPath: other_lg_path,
        source: "settings_alignment",
      }),
    );
    database.close();
  });

  it("提交 translation reset all 时替换 items 并清分析事实", async () => {
    const { database, service, lg_path } = create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: source_path, sortOrder: 0 },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_persistent_item({
            src: "旧",
            dst: "old",
            status: "PROCESSED",
            row_number: 0,
          }),
        ],
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
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { items: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "translation_reset",
          projectRevision: 1,
          sectionRevisions: { items: 1, analysis: 1 },
          updatedSections: ["items", "analysis"],
        },
      ],
    });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item({
        src: "新",
        row_number: 0,
      }),
    ]);
    expect(
      database.execute({
        name: "getAnalysisCandidateAggregates",
        args: { projectPath: lg_path },
      }),
    ).toEqual([]);
    database.close();
  });

  it("translation reset 拒绝旧最终事实载荷且不清空既有 items", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_persistent_item({ dst: "old", status: "PROCESSED" })],
      },
    });

    await expect(
      service.apply_translation_reset({
        mode: "all",
        items: [create_public_item()],
        translation_extras: {},
        prefilter_config: {},
        expected_section_revisions: { items: 0, analysis: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item({ dst: "old", status: "PROCESSED" }),
    ]);
    database.close();
  });

  it("translation reset all 解析窗口内拒绝另一段结构性 write", async () => {
    const { database, service, lg_path } = create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: source_path, sortOrder: 0 },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_persistent_item({
            src: "新",
            dst: "old",
            status: "ERROR",
            row_number: 0,
          }),
        ],
      },
    });
    const { parse_started, release_parse } = pause_next_parse_asset();

    const reset_all_promise = service.apply_translation_reset({
      mode: "all",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { items: 0, analysis: 0 },
    });
    await parse_started;
    try {
      await expect(
        service.apply_translation_reset({
          mode: "failed",
          expected_section_revisions: { items: 0 },
        }),
      ).rejects.toThrow("task.busy");
    } finally {
      release_parse();
    }

    await expect(reset_all_promise).resolves.toMatchObject({ accepted: true });
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item({
        src: "新",
        dst: "",
        status: "NONE",
        row_number: 0,
      }),
    ]);
    database.close();
  });

  it("settings alignment 的 prefiltered_items 拒绝旧最终事实载荷", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_persistent_item()],
      },
    });

    await expect(
      service.apply_settings_alignment({
        mode: "prefiltered_items",
        items: [create_public_item()],
        translation_extras: {},
        prefilter_config: {},
        project_settings: { source_language: "JA" },
        expected_section_revisions: { items: 0, analysis: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item(),
    ]);
    database.close();
  });

  it("导入工作台文件解析窗口内拒绝另一段结构性 write", async () => {
    const { database, service, lg_path } = create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "旧", "utf-8");
    fs.writeFileSync(second_source, "新", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: first_source, sortOrder: 0 },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [
          create_persistent_item({
            src: "旧",
            dst: "old",
            status: "ERROR",
            row_number: 0,
          }),
        ],
      },
    });
    const { parse_started, release_parse } = pause_next_parse_asset();

    const import_files_promise = service.import_workbench_files({
      files: [{ source_path: second_source, target_rel_path: "b.txt" }],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });
    await parse_started;
    try {
      await expect(
        service.apply_translation_reset({
          mode: "failed",
          expected_section_revisions: { items: 0 },
        }),
      ).rejects.toThrow("task.busy");
    } finally {
      release_parse();
    }

    await expect(import_files_promise).resolves.toMatchObject({ accepted: true });
    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item({
        src: "旧",
        dst: "old",
        status: "ERROR",
        row_number: 0,
      }),
      create_persistent_item({
        item_id: 2,
        src: "新",
        file_path: "b.txt",
        row_number: 0,
      }),
    ]);
    database.close();
  });

  it("导入同名工作台文件选择跳过时只新增非同名文件", async () => {
    const { database, service, lg_path } = create_service();
    const old_source = project_path("a.txt");
    const conflict_source = project_path("a-new.txt");
    const new_source = project_path("b.txt");
    fs.writeFileSync(old_source, "旧", "utf-8");
    fs.writeFileSync(conflict_source, "替换候选", "utf-8");
    fs.writeFileSync(new_source, "新", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: old_source, sortOrder: 0 },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })],
      },
    });

    await service.import_workbench_files({
      files: [
        { source_path: conflict_source, target_rel_path: "a.txt" },
        { source_path: new_source, target_rel_path: "b.txt" },
      ],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item({ src: "旧", dst: "old", row_number: 0 }),
      create_persistent_item({ item_id: 2, src: "新", file_path: "b.txt", row_number: 0 }),
    ]);
    expect(database.read_asset_content(lg_path, "a.txt")?.toString("utf-8")).toBe("旧");
    database.close();
  });

  it("导入工作台文件时跳过最终解析失败文件并继续写入成功文件", async () => {
    const log_manager = create_log_manager();
    const { database, service, lg_path } = create_service(undefined, log_manager);
    const valid_source = project_path("valid.txt");
    const broken_json = project_path("broken.json");
    fs.writeFileSync(valid_source, "新", "utf-8");
    fs.writeFileSync(broken_json, "{", "utf-8");

    const ack = await service.import_workbench_files({
      files: [
        { source_path: valid_source, target_rel_path: "valid.txt" },
        { source_path: broken_json, target_rel_path: "broken.json" },
      ],
      conflict_action: "replace",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      failed_files: [
        {
          source_path: broken_json,
          rel_path: "broken.json",
          filename: "broken.json",
          code: "file.parse_failed",
          message_key: "app.error.file.parse_failed.message",
        },
      ],
    });
    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([{ path: "valid.txt", sort_order: 0 }]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      "broken.json - 文件内容解析失败 …",
      expect.objectContaining({ source: "workbench-import" }),
    );
    database.close();
  });

  it("导入工作台文件全部解析失败时不写入工程并返回失败明细", async () => {
    const log_manager = create_log_manager();
    const { database, service, lg_path } = create_service(undefined, log_manager);
    const broken_json = project_path("broken.json");
    fs.writeFileSync(broken_json, "{", "utf-8");

    await expect(
      service.import_workbench_files({
        files: [{ source_path: broken_json, target_rel_path: "broken.json" }],
        conflict_action: "replace",
        project_settings: { source_language: "JA", target_language: "ZH" },
        expected_section_revisions: { files: 0, items: 0, analysis: 0 },
      }),
    ).rejects.toMatchObject({
      code: "file.parse_failed",
      public_details: {
        failed_files: [
          {
            source_path: broken_json,
            rel_path: "broken.json",
            filename: "broken.json",
            code: "file.parse_failed",
            message_key: "app.error.file.parse_failed.message",
          },
        ],
      },
    });

    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      "broken.json - 文件内容解析失败 …",
      expect.objectContaining({ source: "workbench-import" }),
    );
    database.close();
  });

  it("导入同名工作台文件选择替换时保留排序并重建条目", async () => {
    const { database, service, lg_path } = create_service();
    const old_source = project_path("a.txt");
    const replace_source = project_path("a-new.txt");
    fs.writeFileSync(old_source, "旧", "utf-8");
    fs.writeFileSync(replace_source, "新", "utf-8");
    database.execute({
      name: "addAssetFromSource",
      args: { projectPath: lg_path, path: "a.txt", sourcePath: old_source, sortOrder: 3 },
    });
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })],
      },
    });
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
          {
            src: "旧",
            dst_votes: { old: 1 },
            info_votes: {},
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: false,
          },
        ],
      },
    });

    const ack = await service.import_workbench_files({
      files: [{ source_path: replace_source, target_rel_path: "a.txt" }],
      conflict_action: "replace",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "workbench_import_files",
          updatedSections: ["files", "items", "analysis"],
        },
      ],
    });
    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([{ path: "a.txt", sort_order: 3 }]);
    expect(database.read_asset_content(lg_path, "a.txt")?.toString("utf-8")).toBe("新");
    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      create_persistent_item({ item_id: 2, src: "新", file_path: "a.txt", row_number: 0 }),
    ]);
    expect(
      database.execute({
        name: "getAnalysisCandidateAggregates",
        args: { projectPath: lg_path },
      }),
    ).toEqual([]);
    database.close();
  });

  it("同步 write 写库成功后发布后端权威项目变更事件", async () => {
    const { publish_project_change } = create_static_project_change_publisher({ items: 1 });
    const { database, service, lg_path } = create_service({
      publish_project_change,
    } as unknown as ProjectChangePublisher);
    database.execute({
      name: "setItems",
      args: {
        projectPath: lg_path,
        items: [create_persistent_item({ src: "旧", dst: "old", status: "ERROR" })],
      },
    });

    await service.apply_translation_reset({
      mode: "failed",
      expected_section_revisions: { items: 0 },
    });

    expect(publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "translation_reset",
      updatedSections: ["items"],
      sections: {
        items: { payloadMode: "canonical-delta" },
      },
    });
    database.close();
  });

  it("分析候选导入覆盖重复术语时写术语并消费候选池", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      quality: 1,
      analysis: 1,
    });
    const { database, service, lg_path } = create_service({
      publish_project_change,
    } as unknown as ProjectChangePublisher);
    database.execute({
      name: "setRules",
      args: {
        projectPath: lg_path,
        ruleType: "glossary",
        rules: [{ src: "艾琳", dst: "Eileen", info: "旧名", regex: false, case_sensitive: true }],
      },
    });
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
          {
            src: "艾琳",
            dst_votes: { Erin: 1 },
            info_votes: { 角色名: 1 },
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: true,
          },
          {
            src: "王",
            dst_votes: { King: 1 },
            info_votes: { 角色名: 1 },
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: false,
          },
        ],
      },
    });

    const ack = await service.import_analysis_glossary({
      entries: [{ src: "艾琳", dst: "Erin", info: "角色名", regex: false, case_sensitive: true }],
      consumed_candidate_srcs: ["艾琳"],
      expected_section_revisions: { quality: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "analysis_glossary_import",
          projectRevision: 1,
          sectionRevisions: { quality: 1, analysis: 1 },
          updatedSections: ["quality", "analysis"],
        },
      ],
    });
    expect(
      database.execute({ name: "getRules", args: { projectPath: lg_path, ruleType: "glossary" } }),
    ).toEqual([{ src: "艾琳", dst: "Erin", info: "角色名", regex: false, case_sensitive: true }]);
    const remaining_candidates = database.execute({
      name: "getAnalysisCandidateAggregates",
      args: { projectPath: lg_path },
    }) as Array<Record<string, ApiJsonValue>>;
    expect(remaining_candidates.map((candidate) => candidate["src"])).toEqual(["王"]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "analysis_candidate_count", default: 0 },
      }),
    ).toBe(1);
    expect(publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "analysis_glossary_import",
      updatedSections: ["quality", "analysis"],
      sections: {
        quality: { payloadMode: "canonical-delta" },
        analysis: { payloadMode: "canonical-delta" },
      },
    });
    database.close();
  });

  it("分析候选导入拒绝前端提交候选数量事实", async () => {
    const { database, service } = create_service();

    await expect(
      service.import_analysis_glossary({
        entries: [],
        consumed_candidate_srcs: [],
        analysis_candidate_count: 0,
        expected_section_revisions: { quality: 0, analysis: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    database.close();
  });

  it("分析候选导入按共享术语口径重算剩余候选数", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
          {
            src: "艾琳",
            dst_votes: { Erin: 1 },
            info_votes: { 角色名: 1 },
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: true,
          },
          {
            src: "说明",
            dst_votes: { Note: 1 },
            info_votes: { 其他: 1 },
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: false,
          },
        ],
      },
    });

    await service.import_analysis_glossary({
      entries: [{ src: "艾琳", dst: "Erin", info: "角色名", regex: false, case_sensitive: true }],
      consumed_candidate_srcs: ["艾琳"],
      expected_section_revisions: { quality: 0, analysis: 0 },
    });

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "analysis_candidate_count", default: 0 },
      }),
    ).toBe(0);
    database.close();
  });

  it("分析候选导入拒绝旧 glossary 单 revision 字段", async () => {
    const { database, service } = create_service();

    await expect(
      service.import_analysis_glossary({
        entries: [],
        consumed_candidate_srcs: [],
        expected_glossary_revision: 0,
        expected_section_revisions: { quality: 0, analysis: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");
    database.close();
  });

  it("分析候选导入跳过重复术语时只消费候选池和分析 revision", async () => {
    const { publish_project_change } = create_static_project_change_publisher({ analysis: 1 });
    const { database, service, lg_path } = create_service({
      publish_project_change,
    } as unknown as ProjectChangePublisher);
    const existing_rules = [
      { src: "艾琳", dst: "Eileen", info: "旧名", regex: false, case_sensitive: true },
    ];
    database.execute({
      name: "setRules",
      args: {
        projectPath: lg_path,
        ruleType: "glossary",
        rules: existing_rules,
      },
    });
    database.execute({
      name: "upsertAnalysisCandidateAggregates",
      args: {
        projectPath: lg_path,
        aggregates: [
          {
            src: "艾琳",
            dst_votes: { Erin: 1 },
            info_votes: { 角色名: 1 },
            observation_count: 1,
            first_seen_at: "t",
            last_seen_at: "t",
            case_sensitive: true,
          },
        ],
      },
    });

    const ack = await service.import_analysis_glossary({
      entries: existing_rules,
      consumed_candidate_srcs: ["艾琳"],
      expected_section_revisions: { quality: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "analysis_glossary_import",
          projectRevision: 1,
          sectionRevisions: { analysis: 1 },
          updatedSections: ["analysis"],
        },
      ],
    });
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "quality_rule_revision.glossary", default: 0 },
      }),
    ).toBe(0);
    expect(
      database.execute({ name: "getRules", args: { projectPath: lg_path, ruleType: "glossary" } }),
    ).toEqual(existing_rules);
    expect(
      database.execute({
        name: "getAnalysisCandidateAggregates",
        args: { projectPath: lg_path },
      }),
    ).toEqual([]);
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "analysis_candidate_count", default: 0 },
      }),
    ).toBe(0);
    expect(publish_project_change).toHaveBeenCalledWith({
      targetProjectPath: lg_path,
      source: "analysis_glossary_import",
      updatedSections: ["analysis"],
      sections: {
        analysis: { payloadMode: "canonical-delta" },
      },
    });
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

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "workbench_reorder_files",
          projectRevision: 1,
          sectionRevisions: { files: 1 },
          updatedSections: ["files"],
        },
      ],
    });
    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
    database.close();
  });

  it("工作台 reset-file 只写顶层派生 meta 白名单", async () => {
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
        items: [
          create_persistent_item({
            src: "旧",
            dst: "old",
            file_path: "a.txt",
            status: "PROCESSED",
            row_number: 0,
          }),
        ],
      },
    });

    await service.reset_workbench_file({
      rel_paths: ["a.txt"],
      project_settings: { source_language: "JA" },
      expected_section_revisions: { items: 0, analysis: 0 },
    });

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "translation_extras", default: {} },
      }),
    ).toMatchObject({
      processed_line: 0,
      error_line: 0,
      total_line: 1,
      line: 0,
    });
    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "prefilter_config", default: {} },
      }),
    ).toEqual({
      source_language: "JA",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });
    database.close();
  });

  it("任务忙碌时拒绝 translation reset 且不写库", async () => {
    const { database, service, task_run_state, lg_path } = create_service();
    task_run_state.begin_task("translation");
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
        project_settings: { source_language: "JA" },
        expected_section_revisions: { items: 0, analysis: 0 },
      }),
    ).rejects.toThrow("task.busy");

    expect(database.execute({ name: "getAllItems", args: { projectPath: lg_path } })).toEqual([
      { id: 1, src: "旧", dst: "old", status: "PROCESSED" },
    ]);
    database.close();
  });

  it("任务忙碌时拒绝 analysis reset 且不写 analysis meta", async () => {
    const { database, service, task_run_state, lg_path } = create_service();
    task_run_state.begin_task("analysis");

    await expect(
      service.apply_analysis_reset({
        mode: "all",
        expected_section_revisions: { analysis: 0 },
      }),
    ).rejects.toThrow("task.busy");

    expect(
      database.execute({
        name: "getMeta",
        args: { projectPath: lg_path, key: "analysis_extras", default: null },
      }),
    ).toBeNull();
    database.close();
  });

  it("任务忙碌时拒绝工作台文件 write 且不写库", async () => {
    const { database, service, task_run_state, lg_path } = create_service();
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
    task_run_state.begin_task("translation");

    await expect(
      service.reorder_workbench_files({
        ordered_rel_paths: ["b.txt", "a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow("task.busy");

    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: lg_path } }),
    ).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    database.close();
  });

  it("工作台 write 中途失败时仍释放文件 guard", async () => {
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
    ).resolves.toMatchObject({
      accepted: true,
      changes: [
        {
          source: "workbench_reorder_files",
          projectRevision: 1,
          sectionRevisions: { files: 1 },
          updatedSections: ["files"],
        },
      ],
    });
    database.close();
  });

  it("revision 冲突时拒绝写入并不触发 state sync", async () => {
    const { database, service, lg_path } = create_service();
    database.execute({
      name: "setMeta",
      args: { projectPath: lg_path, key: "project_runtime_revision.items", value: 2 },
    });

    await expect(
      service.apply_translation_reset({
        mode: "failed",
        expected_section_revisions: { items: 1 },
      }),
    ).rejects.toThrow("data.revision_conflict");
    database.close();
  });
});
