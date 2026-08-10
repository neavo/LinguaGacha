import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import type { JsonRecord, JsonValue } from "../../domain/json";
import { FileFormatService } from "../file/file-format-service";
import type { LogManager } from "../log/log-manager";
import { RuntimeOperationGate } from "../runtime-operation-gate";
import { ProjectContentService } from "./project-content-service";
import type {
  ProjectChangePublisher,
  ProjectWriteChangeRequest,
} from "./project-write-event-adapter";
import { ProjectWriteStore } from "./project-write-store";
import { get_section_revision } from "./project-data-reader";
import { ProjectSessionState } from "./project-session-state";
import type { ProjectChangeEvent } from "../../shared/project-event";

let temp_dir = "";

/**
 * 所有临时工程路径都落在本用例目录下，避免误碰用户项目文件
 */
function project_path(name: string): string {
  return path.join(temp_dir, name);
}

function read_meta(
  database: ProjectDatabase,
  project_path: string,
  key: string,
  default_value: JsonValue,
): JsonValue {
  return (database.get_all_meta(project_path) as JsonRecord)[key] ?? default_value;
}

/**
 * 为每个用例创建独立 .lg 和服务实例，避免 revision / asset 顺序互相污染
 */
function create_service(
  project_change_publisher?: ProjectChangePublisher | null,
  log_manager: Pick<LogManager, "warning"> | null = create_log_manager(),
): {
  database: ProjectDatabase;
  service: ProjectContentService;
  runtime_gate: RuntimeOperationGate;
  lg_path: string;
} {
  const database = new ProjectDatabase();
  const session_state = new ProjectSessionState();
  const lg_path = project_path("demo.lg");
  database.create_project(lg_path, "demo");
  session_state.mark_loaded(lg_path);
  const publisher =
    project_change_publisher === undefined
      ? create_test_project_change_publisher(database, lg_path)
      : project_change_publisher;
  const runtime_gate = new RuntimeOperationGate();
  const project_event_bus = vi.fn();
  const write_store = new ProjectWriteStore(database, project_event_bus, publisher);
  return {
    database,
    service: new ProjectContentService(
      database,
      runtime_gate,
      session_state,
      write_store,
      null,
      undefined,
      log_manager,
    ),
    runtime_gate,
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
  return vi.fn((payload: ProjectWriteChangeRequest): ProjectChangeEvent => {
    const updated_sections = Array.isArray(payload.updatedSections)
      ? payload.updatedSections.map((section) => String(section))
      : [];
    const meta = database.get_all_meta(lg_path) as JsonRecord;
    const section_revisions = Object.fromEntries(
      updated_sections.map((section) => [section, get_section_revision(meta, section)]),
    );
    return {
      type: "project.changed",
      eventId: `test-${String(payload.source ?? "project_change")}`,
      source: String(payload.source ?? "project_change"),
      projectPath: payload.projectPath,
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
  });
}

function create_static_project_change_publisher(section_revisions: Record<string, number>) {
  return {
    publish_project_change: vi.fn((payload: JsonRecord): ProjectChangeEvent => {
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
        projectPath: String(payload.projectPath ?? ""),
        projectRevision: Math.max(...Object.values(current_section_revisions), 0),
        sectionRevisions: current_section_revisions,
        updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
      };
    }),
  };
}

function create_public_item(overrides: JsonRecord = {}): JsonRecord {
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

function create_persistent_item(overrides: JsonRecord = {}): JsonRecord {
  const item = create_public_item(overrides);
  const { item_id, row_number, ...rest_item } = item;
  return {
    ...rest_item,
    id: item_id,
    row: row_number,
  };
}

/**
 * 暂停下一次格式解析，稳定复现慢准备阶段持有结构性写入租约的窗口
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

describe("ProjectContentService", () => {
  it("写入 settings-only 对齐结果且不 bump 运行态 section", async () => {
    const publish_project_change = vi.fn();
    const { database, service, lg_path } = create_service(publish_project_change);

    const ack = await service.align_settings({
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
    expect(read_meta(database, lg_path, "source_language", "")).toBe("JA");
    database.close();
  });

  it("显式 path 不存在时拒绝 settings-only 对齐且不创建空工程库", async () => {
    const { database, service } = create_service();
    const missing_path = project_path("missing.lg");

    await expect(
      service.align_settings({
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
    const { database, service } = create_service(publish_project_change);
    const other_lg_path = project_path("other.lg");
    const other_source_path = project_path("other.txt");
    fs.writeFileSync(other_source_path, "旧", "utf-8");
    database.create_project(other_lg_path, "other");
    database.add_asset_from_source(other_lg_path, "other.txt", other_source_path, 0);
    database.set_items(other_lg_path, [
      create_persistent_item({ src: "旧", file_path: "other.txt", row_number: 0 }),
    ]);
    const ack = await service.align_settings({
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
        projectPath: other_lg_path,
        source: "settings_alignment",
        updatedSections: ["items", "analysis"],
        items: { payloadMode: "section-invalidated" },
      }),
    );
    database.close();
  });

  it("settings alignment 的 prefiltered_items 在当前工程发布 items 失效信号", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      items: 1,
      analysis: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    database.set_items(lg_path, [
      create_persistent_item({ src: "旧", file_path: "a.txt", row_number: 0 }),
    ]);
    const ack = await service.align_settings({
      mode: "prefiltered_items",
      expected_section_revisions: { items: 0, analysis: 0 },
      project_settings: {
        source_language: "ALL",
        target_language: "ZH",
        mtool_optimizer_enable: true,
        skip_duplicate_source_text_enable: true,
      },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "settings_alignment",
          updatedSections: ["items", "analysis"],
        },
      ],
    });
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "settings_alignment",
      updatedSections: ["items", "analysis"],
      items: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("提交 translation reset all 时替换 items 并清分析事实", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      items: 1,
      analysis: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source_path, 0);
    database.set_items(lg_path, [
      create_persistent_item({
        src: "旧",
        dst: "old",
        status: "PROCESSED",
        row_number: 0,
      }),
    ]);
    database.upsert_analysis_candidate_aggregates(lg_path, [
      {
        src: "旧",
        dst_votes: {},
        info_votes: {},
        observation_count: 1,
        first_seen_at: "t",
        last_seen_at: "t",
        case_sensitive: false,
      },
    ]);
    const ack = await service.reset_translation({
      mode: "all",
      project_settings: { source_language: "JA", target_language: "ZH" },
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
    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        src: "新",
        row_number: 0,
      }),
    ]);
    expect(database.get_analysis_candidate_aggregates(lg_path)).toEqual([]);
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "translation_reset",
      updatedSections: ["items", "analysis"],
      items: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("translation reset 拒绝旧最终事实载荷且不清空既有 items", async () => {
    const { database, service, lg_path } = create_service();
    database.set_items(lg_path, [create_persistent_item({ dst: "old", status: "PROCESSED" })]);

    await expect(
      service.reset_translation({
        mode: "all",
        items: [create_public_item()],
        translation_extras: {},
        prefilter_config: {},
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ dst: "old", status: "PROCESSED" }),
    ]);
    database.close();
  });

  it("translation reset all 解析窗口内拒绝另一段结构性 write", async () => {
    const { database, service, lg_path } = create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source_path, 0);
    database.set_items(lg_path, [
      create_persistent_item({
        src: "新",
        dst: "old",
        status: "ERROR",
        row_number: 0,
      }),
    ]);
    const { parse_started, release_parse } = pause_next_parse_asset();

    const reset_all_promise = service.reset_translation({
      mode: "all",
      project_settings: { source_language: "JA", target_language: "ZH" },
    });
    await parse_started;
    try {
      await expect(
        service.reset_translation({
          mode: "failed",
        }),
      ).rejects.toThrow("runtime.busy");
    } finally {
      release_parse();
    }

    await expect(reset_all_promise).resolves.toMatchObject({ accepted: true });
    expect(database.get_all_items(lg_path)).toEqual([
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
    database.set_items(lg_path, [create_persistent_item()]);

    await expect(
      service.align_settings({
        mode: "prefiltered_items",
        items: [create_public_item()],
        translation_extras: {},
        prefilter_config: {},
        project_settings: { source_language: "JA" },
        expected_section_revisions: { items: 0, analysis: 0 },
      }),
    ).rejects.toThrow("request.validation_failed");

    expect(database.get_all_items(lg_path)).toEqual([create_persistent_item()]);
    database.close();
  });

  it("导入工作台文件解析窗口内拒绝另一段结构性 write", async () => {
    const { database, service, lg_path } = create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "旧", "utf-8");
    fs.writeFileSync(second_source, "新", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", first_source, 0);
    database.set_items(lg_path, [
      create_persistent_item({
        src: "旧",
        dst: "old",
        status: "ERROR",
        row_number: 0,
      }),
    ]);
    const { parse_started, release_parse } = pause_next_parse_asset();

    const import_files_promise = service.import_files({
      files: [{ source_path: second_source, target_rel_path: "b.txt" }],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });
    await parse_started;
    try {
      await expect(
        service.reset_translation({
          mode: "failed",
        }),
      ).rejects.toThrow("runtime.busy");
    } finally {
      release_parse();
    }

    await expect(import_files_promise).resolves.toMatchObject({ accepted: true });
    expect(database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    expect(database.get_all_items(lg_path)).toEqual([
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
    database.add_asset_from_source(lg_path, "a.txt", old_source, 0);
    database.set_items(lg_path, [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })]);

    await service.import_files({
      files: [
        { source_path: conflict_source, target_rel_path: "a.txt" },
        { source_path: new_source, target_rel_path: "b.txt" },
      ],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    expect(database.get_all_items(lg_path)).toEqual([
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
    const ack = await service.import_files({
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
        },
      ],
    });
    expect(database.get_all_asset_records(lg_path)).toEqual([{ path: "valid.txt", sort_order: 0 }]);
    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ src: "新", file_path: "valid.txt", row_number: 0 }),
    ]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      "broken.json - 文件内容解析失败 …",
      expect.objectContaining({ source: "project-import" }),
    );
    database.close();
  });

  it("导入工作台文件全部解析失败时不写入工程并返回失败明细", async () => {
    const log_manager = create_log_manager();
    const { database, service, lg_path } = create_service(undefined, log_manager);
    const broken_json = project_path("broken.json");
    fs.writeFileSync(broken_json, "{", "utf-8");

    await expect(
      service.import_files({
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
          },
        ],
      },
    });

    expect(database.get_all_asset_records(lg_path)).toEqual([]);
    expect(log_manager.warning).toHaveBeenCalledWith(
      "broken.json - 文件内容解析失败 …",
      expect.objectContaining({ source: "project-import" }),
    );
    database.close();
  });

  it("导入同名工作台文件选择替换时保留排序并重建条目", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      files: 1,
      items: 1,
      analysis: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const old_source = project_path("a.txt");
    const replace_source = project_path("a-new.txt");
    fs.writeFileSync(old_source, "旧", "utf-8");
    fs.writeFileSync(replace_source, "新", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", old_source, 3);
    database.set_items(lg_path, [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })]);
    database.upsert_analysis_candidate_aggregates(lg_path, [
      {
        src: "旧",
        dst_votes: { old: 1 },
        info_votes: {},
        observation_count: 1,
        first_seen_at: "t",
        last_seen_at: "t",
        case_sensitive: false,
      },
    ]);

    const ack = await service.import_files({
      files: [{ source_path: replace_source, target_rel_path: "a.txt" }],
      conflict_action: "replace",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_import_files",
          updatedSections: ["files", "items", "analysis"],
        },
      ],
    });
    expect(database.get_all_asset_records(lg_path)).toEqual([{ path: "a.txt", sort_order: 3 }]);
    expect(database.read_asset_content(lg_path, "a.txt")?.toString("utf-8")).toBe("新");
    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ item_id: 2, src: "新", file_path: "a.txt", row_number: 0 }),
    ]);
    expect(database.get_analysis_candidate_aggregates(lg_path)).toEqual([]);
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "project_import_files",
      updatedSections: ["files", "items", "analysis"],
      items: { payloadMode: "section-invalidated" },
      files: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("导入同名工作台文件选择替换并继承译文", async () => {
    const { database, service, lg_path } = create_service();
    const old_source = project_path("a.txt");
    const replace_source = project_path("a-new.txt");
    fs.writeFileSync(old_source, "同文", "utf-8");
    fs.writeFileSync(replace_source, "同文", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", old_source, 2);
    database.set_items(lg_path, [
      create_persistent_item({
        src: "同文",
        dst: "译文",
        status: "PROCESSED",
        row_number: 0,
      }),
    ]);
    await service.import_files({
      files: [{ source_path: replace_source, target_rel_path: "a.txt" }],
      conflict_action: "replace",
      inheritance_mode: "inherit",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        item_id: 2,
        src: "同文",
        dst: "译文",
        status: "PROCESSED",
        file_path: "a.txt",
        row_number: 0,
      }),
    ]);
    database.close();
  });

  it("按完整文件集合重排 assets 并只 bump files section", async () => {
    const { publish_project_change } = create_static_project_change_publisher({ files: 1 });
    const { database, service, lg_path } = create_service(publish_project_change);
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", first_source, 0);
    database.add_asset_from_source(lg_path, "b.txt", second_source, 1);

    const ack = await service.reorder_files({
      ordered_rel_paths: ["b.txt", "a.txt"],
      expected_section_revisions: { files: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_reorder_files",
          projectRevision: 1,
          sectionRevisions: { files: 1 },
          updatedSections: ["files"],
        },
      ],
    });
    expect(database.get_all_asset_records(lg_path)).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "project_reorder_files",
      updatedSections: ["files"],
      files: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("工作台 reset-file 只写顶层计算 meta 白名单", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      items: 1,
      analysis: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source_path, 0);
    database.set_items(lg_path, [
      create_persistent_item({
        src: "旧",
        dst: "old",
        file_path: "a.txt",
        status: "PROCESSED",
        row_number: 0,
      }),
    ]);
    await service.reset_files({
      rel_paths: ["a.txt"],
      project_settings: { source_language: "JA" },
      expected_section_revisions: { items: 0, analysis: 0 },
    });

    expect(read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
      processed_line: 0,
      error_line: 0,
      total_line: 1,
      line: 0,
    });
    expect(read_meta(database, lg_path, "prefilter_config", {})).toEqual({
      source_language: "JA",
      mtool_optimizer_enable: true,
      skip_duplicate_source_text_enable: true,
    });
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "project_reset_files",
      updatedSections: ["items", "analysis"],
      items: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("删除工作台文件时删除 files 和对应 items", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      files: 1,
      items: 1,
      analysis: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", first_source, 0);
    database.add_asset_from_source(lg_path, "b.txt", second_source, 1);
    database.set_items(lg_path, [
      create_persistent_item({ src: "删除", file_path: "a.txt", row_number: 0 }),
      create_persistent_item({
        item_id: 2,
        src: "保留",
        file_path: "b.txt",
        row_number: 0,
      }),
    ]);
    const ack = await service.delete_files({
      rel_paths: ["a.txt"],
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0, analysis: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_delete_files",
          updatedSections: ["files", "items", "analysis"],
        },
      ],
    });
    expect(database.get_all_asset_records(lg_path)).toEqual([{ path: "b.txt", sort_order: 1 }]);
    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ item_id: 2, src: "保留", file_path: "b.txt", row_number: 0 }),
    ]);
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "project_delete_files",
      updatedSections: ["files", "items", "analysis"],
      items: { payloadMode: "section-invalidated" },
      files: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("任务忙碌时拒绝 translation reset 且不写库", async () => {
    const { database, service, runtime_gate, lg_path } = create_service();
    runtime_gate.begin_runtime("task");
    database.set_items(lg_path, [{ id: 1, src: "旧", dst: "old", status: "PROCESSED" }]);

    await expect(
      service.reset_translation({
        mode: "all",
        project_settings: { source_language: "JA" },
      }),
    ).rejects.toThrow("runtime.busy");

    expect(database.get_all_items(lg_path)).toEqual([
      { id: 1, src: "旧", dst: "old", status: "PROCESSED" },
    ]);
    database.close();
  });

  it("任务忙碌时拒绝 analysis reset 且不写 analysis meta", async () => {
    const { database, service, runtime_gate, lg_path } = create_service();
    runtime_gate.begin_runtime("task");

    await expect(
      service.reset_analysis({
        mode: "all",
      }),
    ).rejects.toThrow("runtime.busy");

    expect(read_meta(database, lg_path, "analysis_extras", null)).toBeNull();
    database.close();
  });

  it("任务忙碌时拒绝 settings-only 对齐且不写设置 meta", async () => {
    const { database, service, runtime_gate, lg_path } = create_service();
    runtime_gate.begin_runtime("task");

    await expect(
      service.align_settings({
        mode: "settings_only",
        project_settings: { source_language: "JA" },
      }),
    ).rejects.toThrow("runtime.busy");

    expect(read_meta(database, lg_path, "source_language", "")).toBe("");
    database.close();
  });

  it("任务忙碌时拒绝工作台文件 write 且不写库", async () => {
    const { database, service, runtime_gate, lg_path } = create_service();
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", first_source, 0);
    database.add_asset_from_source(lg_path, "b.txt", second_source, 1);
    runtime_gate.begin_runtime("task");

    await expect(
      service.reorder_files({
        ordered_rel_paths: ["b.txt", "a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow("runtime.busy");

    expect(database.get_all_asset_records(lg_path)).toEqual([
      { path: "a.txt", sort_order: 0 },
      { path: "b.txt", sort_order: 1 },
    ]);
    database.close();
  });

  it("工作台 write 中途失败时仍释放文件 guard", async () => {
    const { database, service, lg_path } = create_service();
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source_path, 0);
    const transaction_spy = vi.spyOn(database, "transaction").mockImplementation(() => {
      throw new Error("事务失败");
    });

    await expect(
      service.reorder_files({
        ordered_rel_paths: ["a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).rejects.toThrow("事务失败");

    transaction_spy.mockRestore();
    await expect(
      service.reorder_files({
        ordered_rel_paths: ["a.txt"],
        expected_section_revisions: { files: 0 },
      }),
    ).resolves.toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_reorder_files",
          projectRevision: 1,
          sectionRevisions: { files: 1 },
          updatedSections: ["files"],
        },
      ],
    });
    database.close();
  });

  it("翻译与分析重置命令都拒绝旧 revision 字段", async () => {
    const { database, service, lg_path } = create_service();
    database.set_meta(lg_path, "project_runtime_revision.items", 2);

    await expect(
      service.reset_translation({
        mode: "failed",
        expected_section_revisions: { items: 1 },
      }),
    ).rejects.toThrow("request.validation_failed");
    await expect(
      service.reset_analysis({
        mode: "failed",
        expected_section_revisions: { analysis: 1 },
      }),
    ).rejects.toThrow("request.validation_failed");
    database.close();
  });
});
