import { create_pdf_execution } from "../file/formats/pdf/test-support";
import { create_pdf_fixture } from "../file/formats/pdf/test-support";
import { ProjectDataReader } from "./project-data-reader";
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

/** 从真实数据库读取设置或统计，供持久化结果断言使用。 */
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
  session_state: ProjectSessionState;
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
      create_pdf_execution(),
      null,
      undefined,
      log_manager,
    ),
    runtime_gate,
    session_state,
    lg_path,
  };
}

/** 收集解析警告供断言，避免测试写入真实日志。 */
function create_log_manager(): Pick<LogManager, "warning"> {
  return {
    warning: vi.fn(),
  };
}

/** 从真实数据库读取修订号，模拟提交后的项目事件。 */
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
        : { items: payload.items as NonNullable<ProjectChangeEvent["items"]> }),
      ...(payload.files === undefined
        ? {}
        : { files: payload.files as NonNullable<ProjectChangeEvent["files"]> }),
      ...(payload.sections === undefined
        ? {}
        : { sections: payload.sections as NonNullable<ProjectChangeEvent["sections"]> }),
    };
  });
}

/** 固定修订号，用于只验证写入及事件形状的用例。 */
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

/** 补齐公开条目默认字段，用例只声明影响当前行为的差异。 */
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

/** 从同一份默认条目转换数据库字段，避免维护两套测试数据。 */
function create_persistent_item(overrides: JsonRecord = {}): JsonRecord {
  const item = create_public_item(overrides);
  const { item_id, row_number, ...rest_item } = item;
  return {
    ...rest_item,
    id: item_id!,
    row: row_number!,
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
  vi.spyOn(FileFormatService.prototype, "parse_asset").mockImplementationOnce(async function (
    this: FileFormatService,
    rel_path,
    content,
  ) {
    mark_parse_started();
    await parse_released;
    return original_parse_asset.call(this, rel_path, content);
  });
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
  it("混合导入仅文本生成 Item，PDF 替换和全部重置清空独立译稿", async () => {
    const { database, service, lg_path } = create_service();
    try {
      const source = project_path("book.pdf");
      const text = project_path("story.txt");
      fs.writeFileSync(source, create_pdf_fixture());
      fs.writeFileSync(text, "Hello world");
      const revisions = () =>
        new ProjectDataReader(database).build_manifest({ loaded: true, projectPath: lg_path })[
          "sectionRevisions"
        ];
      await service.import_files({
        files: [
          { source_path: source, target_rel_path: "book.pdf" },
          { source_path: text, target_rel_path: "story.txt" },
        ],
        conflict_action: "replace",
        expected_section_revisions: revisions()!,
      });
      expect(database.get_item_count(lg_path)).toBe(1);
      expect(new ProjectDataReader(database).build_files_record_block(lg_path)).toMatchObject({
        "book.pdf": { file_type: "PDF" },
        "story.txt": { file_type: "TXT" },
      });
      const old = database.read_pdf_document(lg_path, "book.pdf")!;
      const update = {
        translation: { kind: "translate" as const, markdown: "已有译文" },
        reviewed: true,
        notes: "继续",
      };
      database.write_pdf_page(lg_path, "book.pdf", { ...old.pages[0]!, ...update });
      fs.writeFileSync(source, create_pdf_fixture(["replacement"]));
      await service.import_files({
        files: [{ source_path: source, target_rel_path: "book.pdf" }],
        conflict_action: "replace",
        expected_section_revisions: revisions()!,
      });
      const next = database.read_pdf_document(lg_path, "book.pdf")!;
      expect(next.pages[0]).toMatchObject({ translation: null, reviewed: false, notes: "" });
      expect(next.digest).not.toBe(old.digest);
      expect(next.pages).toHaveLength(1);
      database.write_pdf_page(lg_path, "book.pdf", { ...next.pages[0]!, ...update });
      await service.reset_translation({ mode: "all" });
      expect(database.read_pdf_document(lg_path, "book.pdf")?.pages[0]).toMatchObject({
        translation: null,
        reviewed: false,
        notes: "",
      });
      expect(database.get_item_count(lg_path)).toBe(1);
    } finally {
      database.close();
    }
  });
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

  it.each(["空会话", "已加载其他工程"] as const)(
    "%s 时按目标路径对齐设置和条目，并保持会话隔离",
    async (session_kind) => {
      const publish_project_change = vi.fn(() => null);
      const { database, service, session_state } = create_service(publish_project_change);
      try {
        if (session_kind === "空会话") await session_state.clear();
        const initial_session = session_state.snapshot();
        const other_lg_path = project_path("other.lg");
        const other_source_path = project_path("other.txt");
        fs.writeFileSync(other_source_path, "原文", "utf-8");
        database.create_project(other_lg_path, "other");
        database.add_asset_from_source(other_lg_path, "other.txt", other_source_path, null, 0);
        database.set_meta(other_lg_path, "source_language", "JA");
        database.set_items(other_lg_path, [
          create_persistent_item({ file_path: "other.txt", status: "LANGUAGE_SKIPPED" }),
        ]);
        // 工程路径是读取契约的一部分，必须与本次对齐目标一致。
        const read_pdf_summaries = vi.spyOn(database, "read_pdf_summaries");
        const ack = await service.align_settings({
          path: other_lg_path,
          mode: "prefiltered_items",
          expected_section_revisions: { items: 0 },
          project_settings: {
            source_language: "ALL",
            target_language: "ZH",
            mtool_optimizer_enable: false,
            skip_duplicate_source_text_enable: true,
          },
        });

        expect(read_pdf_summaries).toHaveBeenCalledWith(other_lg_path);
        expect(read_meta(database, other_lg_path, "source_language", "")).toBe("ALL");
        expect(database.get_all_items(other_lg_path)).toEqual([
          create_persistent_item({ file_path: "other.txt", status: "NONE" }),
        ]);
        expect(session_state.snapshot()).toEqual(initial_session);
        expect(ack).toEqual({ accepted: true, changes: [] });
        expect(publish_project_change).toHaveBeenCalledWith(
          expect.objectContaining({
            projectPath: other_lg_path,
            source: "settings_alignment",
            updatedSections: ["items"],
            items: { payloadMode: "section-invalidated" },
          }),
        );
      } finally {
        database.close();
      }
    },
  );

  it("settings alignment 的 prefiltered_items 在当前工程发布 items 失效信号", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      items: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    database.set_items(lg_path, [
      create_persistent_item({ src: "旧", file_path: "a.txt", row_number: 0 }),
    ]);
    const ack = await service.align_settings({
      mode: "prefiltered_items",
      expected_section_revisions: { items: 0 },
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
          updatedSections: ["items"],
        },
      ],
    });
    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "settings_alignment",
      updatedSections: ["items"],
      items: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("全部重置重建条目并发布全量失效", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      items: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "新", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source_path, null, 0);
    database.set_items(lg_path, [
      create_persistent_item({
        src: "旧",
        dst: "old",
        status: "PROCESSED",
        row_number: 0,
      }),
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
          sectionRevisions: { items: 1 },
          updatedSections: ["items"],
        },
      ],
    });
    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({
        item_id: 2,
        src: "新",
        row_number: 0,
      }),
    ]);

    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "translation_reset",
      updatedSections: ["items"],
      items: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it.each([
    {
      file: "source.json",
      file_type: "KVJSON",
      content: JSON.stringify({ 翻訳済みの文章: "源文件译文", 未翻訳の文章: "" }),
    },
    {
      file: "source.trans",
      file_type: "TRANS",
      content: JSON.stringify({
        project: {
          files: {
            chapter: {
              data: [
                ["翻訳済みの文章", "源文件译文"],
                ["未翻訳の文章", ""],
              ],
            },
          },
        },
      }),
    },
  ])("全部重置从 $file 的工程资产恢复自带译文并重建进度", async ({ file, file_type, content }) => {
    const { database, service, lg_path } = create_service();
    try {
      const source = project_path(file);
      fs.writeFileSync(source, content, "utf-8");
      database.add_asset_from_source(lg_path, file, source, null, 0);
      // 重置读取工程内的源文件快照，外部文件后续变化不参与恢复。
      fs.writeFileSync(source, "外部文件已变更", "utf-8");
      database.set_items(lg_path, [
        create_persistent_item({
          item_id: 10,
          file_path: file,
          file_type,
          row_number: 0,
          src: "翻訳済みの文章",
          dst: "项目中修改后的译文",
          status: "PROCESSED",
        }),
        create_persistent_item({
          item_id: 11,
          file_path: file,
          file_type,
          row_number: 1,
          src: "未翻訳の文章",
          dst: "项目中新增的译文",
          status: "PROCESSED",
        }),
      ]);
      database.set_meta(lg_path, "translation_extras", {
        total_line: 2,
        line: 2,
        processed_line: 2,
        error_line: 0,
        total_tokens: 100,
        total_input_tokens: 60,
        total_output_tokens: 40,
        time: 12,
      });

      await service.reset_translation({ mode: "all", project_settings: { source_language: "JA" } });

      const items = database.get_all_items(lg_path) as JsonRecord[];
      expect(items.map(({ src, dst, status }) => ({ src, dst, status }))).toEqual([
        { src: "翻訳済みの文章", dst: "源文件译文", status: "PROCESSED" },
        { src: "未翻訳の文章", dst: "", status: "NONE" },
      ]);
      expect(read_meta(database, lg_path, "translation_extras", {})).toMatchObject({
        total_line: 2,
        line: 1,
        processed_line: 1,
        error_line: 0,
        total_tokens: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        time: 0,
      });
    } finally {
      database.close();
    }
  });

  it.each(["第一行\n第二行\n第三行", "一行", ""])("全部重置允许条目数变化：%s", async (content) => {
    const { database, service, lg_path } = create_service();
    const source = project_path("a.txt");
    fs.writeFileSync(source, content, "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source, null, 0);
    database.set_items(lg_path, [
      create_persistent_item({ item_id: 20, row_number: 0, dst: "旧译文", status: "PROCESSED" }),
      create_persistent_item({ item_id: 21, row_number: 1 }),
    ]);
    await service.reset_translation({ mode: "all" });
    const items = database.get_all_items(lg_path) as JsonRecord[];
    const expected = content === "" ? [] : content.split("\n");
    expect(items.map((item) => item["src"])).toEqual(expected);
    expect(items.every((item) => Number(item["id"]) > 21 && item["dst"] === "")).toBe(true);
    database.close();
    const reopened = new ProjectDatabase();
    expect(reopened.get_all_items(lg_path)).toEqual(items);
    reopened.close();
  });

  it.each(["missing", "parse", "commit"])(
    "全部重置在 %s 失败时保留条目和项目元数据",
    async (failure) => {
      const { database, service, lg_path } = create_service();
      const file = failure === "parse" ? "a.json" : "a.txt";
      const source = project_path(file);
      fs.writeFileSync(source, "新正文", "utf-8");
      database.add_asset_from_source(lg_path, file, source, null, 0);
      database.set_items(lg_path, [
        create_persistent_item({ file_path: file, dst: "已有译文", status: "PROCESSED" }),
      ]);
      const before_items = database.get_all_items(lg_path);
      const before_meta = database.get_all_meta(lg_path);
      if (failure === "missing") vi.spyOn(database, "read_asset_content").mockReturnValueOnce(null);
      if (failure === "commit") {
        const set_items = database.set_items.bind(database);
        vi.spyOn(database, "set_items").mockImplementationOnce((...args) => {
          set_items(...args);
          throw new Error("commit probe");
        });
      }
      await expect(service.reset_translation({ mode: "all" })).rejects.toThrow();
      expect(database.get_all_items(lg_path)).toEqual(before_items);
      expect(database.get_all_meta(lg_path)).toEqual(before_meta);
      database.close();
    },
  );

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
    database.add_asset_from_source(lg_path, "a.txt", source_path, null, 0);
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
        item_id: 2,
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
        expected_section_revisions: { items: 0 },
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
    database.add_asset_from_source(lg_path, "a.txt", first_source, null, 0);
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
      expected_section_revisions: { files: 0, items: 0 },
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
    database.add_asset_from_source(lg_path, "a.txt", old_source, null, 0);
    database.set_items(lg_path, [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })]);

    await service.import_files({
      files: [
        { source_path: conflict_source, target_rel_path: "a.txt" },
        { source_path: new_source, target_rel_path: "b.txt" },
      ],
      conflict_action: "skip",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
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
      expected_section_revisions: { files: 0, items: 0 },
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
      expect.stringContaining("broken.json"),
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
        expected_section_revisions: { files: 0, items: 0 },
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
      expect.stringContaining("broken.json"),
      expect.objectContaining({ source: "project-import" }),
    );
    database.close();
  });

  it("导入同名工作台文件选择替换时保留排序并重建条目", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      files: 1,
      items: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const old_source = project_path("a.txt");
    const replace_source = project_path("a-new.txt");
    fs.writeFileSync(old_source, "旧", "utf-8");
    fs.writeFileSync(replace_source, "新", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", old_source, null, 3);
    database.set_items(lg_path, [create_persistent_item({ src: "旧", dst: "old", row_number: 0 })]);

    const ack = await service.import_files({
      files: [{ source_path: replace_source, target_rel_path: "a.txt" }],
      conflict_action: "replace",
      project_settings: { source_language: "JA", target_language: "ZH" },
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_import_files",
          updatedSections: ["files", "items"],
        },
      ],
    });
    expect(database.get_all_asset_records(lg_path)).toEqual([{ path: "a.txt", sort_order: 3 }]);
    expect(database.read_asset_content(lg_path, "a.txt")?.toString("utf-8")).toBe("新");
    expect(database.get_all_items(lg_path)).toEqual([
      create_persistent_item({ item_id: 2, src: "新", file_path: "a.txt", row_number: 0 }),
    ]);

    expect(publish_project_change).toHaveBeenCalledWith({
      projectPath: lg_path,
      source: "project_import_files",
      updatedSections: ["files", "items"],
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
    database.add_asset_from_source(lg_path, "a.txt", old_source, null, 2);
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
      expected_section_revisions: { files: 0, items: 0 },
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
    database.add_asset_from_source(lg_path, "a.txt", first_source, null, 0);
    database.add_asset_from_source(lg_path, "b.txt", second_source, null, 1);

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
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const source_path = project_path("a.txt");
    fs.writeFileSync(source_path, "a", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", source_path, null, 0);
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
      expected_section_revisions: { items: 0 },
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
      updatedSections: ["items"],
      items: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("删除工作台文件时删除 files 和对应 items", async () => {
    const { publish_project_change } = create_static_project_change_publisher({
      files: 1,
      items: 1,
    });
    const { database, service, lg_path } = create_service(publish_project_change);
    const first_source = project_path("a.txt");
    const second_source = project_path("b.txt");
    fs.writeFileSync(first_source, "a", "utf-8");
    fs.writeFileSync(second_source, "b", "utf-8");
    database.add_asset_from_source(lg_path, "a.txt", first_source, null, 0);
    database.add_asset_from_source(lg_path, "b.txt", second_source, null, 1);
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
      expected_section_revisions: { files: 0, items: 0 },
    });

    expect(ack).toMatchObject({
      accepted: true,
      changes: [
        {
          source: "project_delete_files",
          updatedSections: ["files", "items"],
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
      updatedSections: ["files", "items"],
      items: { payloadMode: "section-invalidated" },
      files: { payloadMode: "section-invalidated" },
    });
    database.close();
  });

  it("任务忙碌时拒绝 translation reset 且不写库", async () => {
    const { database, service, runtime_gate, lg_path } = create_service();
    runtime_gate.begin_runtime("batch_translation");
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

  it("任务忙碌时拒绝 settings-only 对齐且不写设置 meta", async () => {
    const { database, service, runtime_gate, lg_path } = create_service();
    runtime_gate.begin_runtime("batch_translation");

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
    database.add_asset_from_source(lg_path, "a.txt", first_source, null, 0);
    database.add_asset_from_source(lg_path, "b.txt", second_source, null, 1);
    runtime_gate.begin_runtime("batch_translation");

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
    database.add_asset_from_source(lg_path, "a.txt", source_path, null, 0);
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

  it("翻译重置命令拒绝旧 revision 字段", async () => {
    const { database, service, lg_path } = create_service();
    database.set_meta(lg_path, "project_runtime_revision.items", 2);

    await expect(
      service.reset_translation({
        mode: "failed",
        expected_section_revisions: { items: 1 },
      }),
    ).rejects.toThrow("request.validation_failed");

    database.close();
  });
});
