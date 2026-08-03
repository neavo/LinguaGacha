import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../../domain/json";
import { ProjectDatabase } from "../database/database-operations";
import type {
  ProjectChangePublisher,
  ProjectWriteChangeRequest,
} from "./project-write-event-adapter";
import { get_section_revision } from "./project-data-reader";
import type { ProjectEventHandler } from "./project-events";
import { ProjectWriteStore } from "./project-write-store";
import type { ProjectChangeEvent } from "../../shared/project-event";

describe("ProjectWriteStore", () => {
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("按 item_id 局部提交翻译 patch 并保留持久 item 事实", async () => {
    const { database, project_path, store, published_changes } = create_store("translation");
    seed_items(database, project_path);

    const ack = await store.apply_translation_item_patches({
      projectPath: project_path,
      items: [
        {
          item_id: 1,
          patch: {
            dst: "译文",
            name_dst: ["译名"],
            status: "PROCESSED",
            retry_count: 0,
          },
        },
      ],
      translationExtras: { processed_line: 1, total_line: 1 },
    });

    expect(ack).toEqual({
      changed_item_ids: [1],
      section_revisions: { items: 1 },
    });
    expect(read_items(database, project_path)).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        name_src: "原名",
        name_dst: ["译名"],
        status: "PROCESSED",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
      },
    ]);
    expect(read_meta(database, project_path)).toMatchObject({
      translation_extras: { processed_line: 1, total_line: 1 },
      "project_runtime_revision.items": 1,
    });
    expect(published_changes).toEqual([
      expect.objectContaining({
        projectPath: project_path,
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: { payloadMode: "canonical-delta", changedIds: [1] },
      }),
    ]);
  });

  it("拒绝指向不存在 item 的 typed patch", async () => {
    const { project_path, store } = create_store("invalid-patch");

    await expect(
      store.apply_translation_item_patches({
        projectPath: project_path,
        items: [{ item_id: 99, patch: { dst: "不存在" } }],
        translationExtras: {},
      }),
    ).rejects.toThrow("runtime.internal_invariant");
  });

  it("校对字段 patch 会推进 proofreading revision 并更新翻译统计", async () => {
    const { database, project_path, store, published_changes } = create_store("proofreading");
    seed_items(database, project_path);
    database.upsert_meta_entries(project_path, {
      translation_extras: { total_line: 1, processed_line: 0, error_line: 0, line: 0 },
    });

    await store.apply_proofreading_item_patch({
      projectPath: project_path,
      expectedSectionRevisions: { items: 0, proofreading: 0 },
      source: "proofreading_update_items",
      changes: [
        {
          current: { id: 1, dst: "", status: "NONE", retry_count: 0 },
          next: { id: 1, dst: "校对译文", status: "PROCESSED", retry_count: 0 },
        },
      ],
      fieldPatch: { dst: "校对译文", status: "PROCESSED" },
      updateTranslationExtras: true,
    });

    expect(read_items(database, project_path)[0]).toMatchObject({
      id: 1,
      dst: "校对译文",
      status: "PROCESSED",
      src: "原文",
      file_path: "demo.txt",
    });
    expect(read_meta(database, project_path)).toMatchObject({
      "project_runtime_revision.items": 1,
      "proofreading_revision.proofreading": 1,
      translation_extras: expect.objectContaining({
        total_line: 1,
        processed_line: 1,
        error_line: 0,
        line: 1,
      }),
    });
    expect(published_changes.at(-1)).toMatchObject({
      source: "proofreading_update_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: { dst: "校对译文", status: "PROCESSED" },
      },
    });
  });

  it("提交工作台结构写入时替换事实并发布轻量失效信号", async () => {
    const { database, project_path, store, published_changes } = create_store("project-content");
    seed_items(database, project_path);
    add_test_asset(database, project_path, "demo.txt", "demo", 0);
    database.upsert_analysis_item_checkpoints(project_path, [
      { item_id: 1, status: "PROCESSED", updated_at: "now", error_count: 0 },
    ]);

    await store.replace_project_items_and_files({
      projectPath: project_path,
      expectedSectionRevisions: { files: 0, items: 0, analysis: 0 },
      revisionSections: ["files", "items", "analysis"],
      source: "project_delete_files",
      updatedSections: ["files", "items", "analysis"],
      assetWrites: [{ kind: "delete", path: "demo.txt" }],
      items: [],
      meta: { translation_extras: {}, analysis_candidate_count: 0 },
      resetAnalysis: true,
    });

    expect(database.get_asset_count(project_path)).toBe(0);
    expect(read_items(database, project_path)).toEqual([]);
    expect(database.get_analysis_item_checkpoints(project_path)).toEqual([]);
    expect(read_meta(database, project_path)).toMatchObject({
      "project_runtime_revision.files": 1,
      "project_runtime_revision.items": 1,
      "project_runtime_revision.analysis": 1,
    });
    expect(published_changes.at(-1)).toMatchObject({
      source: "project_delete_files",
      updatedSections: ["files", "items", "analysis"],
      items: { payloadMode: "section-invalidated" },
      files: { payloadMode: "section-invalidated" },
    });
  });

  it("文件排序只发布 files 失效信号", async () => {
    const { database, project_path, store, published_changes } = create_store("reorder");
    add_test_asset(database, project_path, "a.txt", "a", 0);
    add_test_asset(database, project_path, "b.txt", "b", 1);

    await store.reorder_project_files({
      projectPath: project_path,
      expectedSectionRevisions: { files: 0 },
      orderedPaths: ["b.txt", "a.txt"],
    });

    expect(database.get_all_asset_records(project_path)).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
    expect(published_changes.at(-1)).toMatchObject({
      source: "project_reorder_files",
      updatedSections: ["files"],
      files: { payloadMode: "section-invalidated" },
    });
    expect(published_changes.at(-1)).not.toHaveProperty("sections");
  });

  it("revision guard 与写入共享同一数据库事务", async () => {
    const { database, project_path, store } = create_store("transaction-boundary");
    add_test_asset(database, project_path, "a.txt", "a", 0);
    add_test_asset(database, project_path, "b.txt", "b", 1);
    const original_transaction = database.transaction.bind(database);
    const original_get_all_meta = database.get_all_meta.bind(database);
    const original_update_asset_sort_orders = database.update_asset_sort_orders.bind(database);
    const meta_read_transaction_states: boolean[] = [];
    const write_transaction_states: boolean[] = [];
    let transaction_active = false;
    vi.spyOn(database, "transaction").mockImplementation(
      <T>(target_path: string, callback: () => T): T =>
        original_transaction(target_path, () => {
          transaction_active = true;
          try {
            return callback();
          } finally {
            transaction_active = false;
          }
        }),
    );
    vi.spyOn(database, "get_all_meta").mockImplementation((target_path) => {
      meta_read_transaction_states.push(transaction_active);
      return original_get_all_meta(target_path);
    });
    vi.spyOn(database, "update_asset_sort_orders").mockImplementation(
      (target_path, ordered_paths) => {
        write_transaction_states.push(transaction_active);
        return original_update_asset_sort_orders(target_path, ordered_paths);
      },
    );

    await store.reorder_project_files({
      projectPath: project_path,
      expectedSectionRevisions: { files: 0 },
      orderedPaths: ["b.txt", "a.txt"],
    });

    expect(meta_read_transaction_states[0]).toBe(true);
    expect(write_transaction_states).toEqual([true]);
    expect(read_meta(database, project_path)["project_runtime_revision.files"]).toBe(1);
  });

  it("数据库提交后先维护内部缓存，再发布公开项目变更", async () => {
    const calls: string[] = [];
    const { database, project_path, store } = create_store("event-order", {
      projectEventHandler: (event) => {
        calls.push(`internal:${event.sectionRevisions.files ?? 0}`);
      },
      onPublish: () => calls.push("public"),
    });
    add_test_asset(database, project_path, "a.txt", "a", 0);

    await store.reorder_project_files({
      projectPath: project_path,
      expectedSectionRevisions: { files: 0 },
      orderedPaths: ["a.txt"],
    });

    expect(calls).toEqual(["internal:1", "public"]);
  });

  it("内部缓存事件失败时阻断公开发布，但保留已提交事实", async () => {
    const dispatch_error = new Error("cache update failed");
    const { database, project_path, store, published_changes } = create_store("event-failure", {
      projectEventHandler: () => {
        throw dispatch_error;
      },
    });
    add_test_asset(database, project_path, "a.txt", "a", 0);

    await expect(
      store.reorder_project_files({
        projectPath: project_path,
        expectedSectionRevisions: { files: 0 },
        orderedPaths: ["a.txt"],
      }),
    ).rejects.toBe(dispatch_error);

    expect(read_meta(database, project_path)["project_runtime_revision.files"]).toBe(1);
    expect(published_changes).toEqual([]);
  });

  it("提交质量规则和提示词时写入各自 revision", async () => {
    const { database, project_path, store } = create_store("quality");

    await store.save_quality_rules({
      projectPath: project_path,
      expectedSectionRevisions: { quality: 0 },
      source: "quality_rule_update",
      rule: {
        databaseType: "glossary",
        entries: [{ src: "姫", dst: "公主" }],
      },
      revisionKey: "quality_rule_revision.glossary",
    });
    await store.save_prompt({
      projectPath: project_path,
      expectedSectionRevisions: { prompts: 0 },
      promptRuleType: "translation_prompt",
      text: "请翻译",
      revisionKey: "quality_prompt_revision.translation",
      enabledMetaKey: "translation_prompt_enable",
      enabled: true,
    });

    expect(database.get_rules(project_path, "glossary")).toEqual([{ src: "姫", dst: "公主" }]);
    expect(database.get_rule_text(project_path, "translation_prompt")).toBe("请翻译");
    expect(read_meta(database, project_path)).toMatchObject({
      "quality_rule_revision.glossary": 1,
      "quality_prompt_revision.translation": 1,
      translation_prompt_enable: true,
    });
  });

  it("提交分析 artifact 时合并候选并发布轻量 analysis delta", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    cleanup_callbacks.push(() => vi.useRealTimers());
    const { database, project_path, store, published_changes } = create_store("analysis");

    const ack = await store.commit_analysis_artifacts({
      projectPath: project_path,
      successCheckpoints: [
        {
          item_id: 1,
          status: "PROCESSED",
          updated_at: "2026-01-01T00:00:00.000Z",
          error_count: 0,
        },
      ],
      errorCheckpoints: [],
      glossaryEntries: [{ src: "魔法", dst: "magic", info: "术语", case_sensitive: true }],
      progressSnapshot: {
        start_time: 0,
        time: 0,
        total_line: 1,
        line: 1,
        processed_line: 1,
        error_line: 0,
        total_tokens: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
      },
    });

    expect(ack).toMatchObject({
      inserted_count: 1,
      analysis_candidate_count: 1,
      section_revisions: { analysis: 1 },
    });
    expect(database.get_analysis_item_checkpoints(project_path)).toEqual([
      {
        item_id: 1,
        status: "PROCESSED",
        updated_at: "2026-01-01T00:00:00.000Z",
        error_count: 0,
      },
    ]);
    expect(published_changes.at(-1)).toMatchObject({
      source: "analysis_batch_update",
      updatedSections: ["analysis"],
      sections: {
        analysis: {
          payloadMode: "canonical-delta",
          data: expect.objectContaining({ candidate_count: 1 }),
        },
      },
    });
  });

  it("一次性应用领域任务输入并发布 quality / prompts 提交事件", async () => {
    const project_event_handler = vi.fn();
    const { database, project_path, store, published_changes } = create_store("task-input", {
      projectEventHandler: project_event_handler,
    });

    const result = await store.apply_task_input({
      projectPath: project_path,
      expectedSectionRevisions: { quality: 0, prompts: 0 },
      input: {
        quality_rules: [
          {
            kind: "glossary",
            entries: [{ src: "HP", dst: "生命值", info: "", case_sensitive: false }],
            enabled: true,
            mode: null,
          },
        ],
        prompts: [
          {
            kind: "translation",
            text: "翻译提示词",
            enabled: true,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      accepted: true,
      changes: [{ updatedSections: ["quality", "prompts"] }],
    });
    expect(database.get_rules(project_path, "glossary")).toEqual([
      { src: "HP", dst: "生命值", info: "", case_sensitive: false },
    ]);
    expect(database.get_rule_text(project_path, "translation_prompt")).toBe("翻译提示词");
    expect(read_meta(database, project_path)).toMatchObject({
      glossary_enable: true,
      translation_prompt_enable: true,
      "quality_rule_revision.glossary": 1,
      "quality_prompt_revision.translation": 1,
    });
    expect(project_event_handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "project.quality.changed" }),
    );
    expect(project_event_handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "project.prompts.changed" }),
    );
    expect(published_changes.at(-1)).toEqual({
      projectPath: project_path,
      source: "project_task_input_apply",
      updatedSections: ["quality", "prompts"],
    });
  });

  function create_store(
    name: string,
    options: {
      projectEventHandler?: ProjectEventHandler;
      onPublish?: () => void;
    } = {},
  ): {
    database: ProjectDatabase;
    project_path: string;
    store: ProjectWriteStore;
    published_changes: MutableJsonRecord[];
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `linguagacha-write-${name}-`));
    const project_path = path.join(directory, `${name}.lg`);
    const database = new ProjectDatabase();
    const project_event_handler = options.projectEventHandler ?? vi.fn();
    const published_changes: MutableJsonRecord[] = [];
    database.create_project(project_path, name);
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    return {
      database,
      project_path,
      store: new ProjectWriteStore(
        database,
        project_event_handler,
        create_project_change_publisher(
          database,
          project_path,
          published_changes,
          options.onPublish,
        ),
      ),
      published_changes,
    };
  }

  function create_project_change_publisher(
    database: ProjectDatabase,
    project_path: string,
    published_changes: MutableJsonRecord[],
    on_publish?: () => void,
  ): ProjectChangePublisher {
    return vi.fn((payload: ProjectWriteChangeRequest): ProjectChangeEvent => {
      on_publish?.();
      published_changes.push(payload);
      const updated_sections = Array.isArray(payload["updatedSections"])
        ? payload["updatedSections"].map((section) => String(section))
        : [];
      const meta = read_meta(database, project_path);
      const section_revisions = Object.fromEntries(
        updated_sections.map((section) => [section, get_section_revision(meta, section)]),
      );
      return {
        type: "project.changed",
        eventId: `test-${String(payload["source"] ?? "project_change")}`,
        source: String(payload["source"] ?? "project_change"),
        projectPath: payload.projectPath,
        projectRevision: Math.max(...Object.values(section_revisions), 0),
        sectionRevisions: section_revisions,
        updatedSections: updated_sections as ProjectChangeEvent["updatedSections"],
        ...(payload["items"] === undefined
          ? {}
          : { items: payload["items"] as ProjectChangeEvent["items"] }),
        ...(payload["files"] === undefined
          ? {}
          : { files: payload["files"] as ProjectChangeEvent["files"] }),
        ...(payload["sections"] === undefined
          ? {}
          : { sections: payload["sections"] as ProjectChangeEvent["sections"] }),
      };
    });
  }

  function seed_items(database: ProjectDatabase, project_path: string): void {
    database.set_items(project_path, [
      {
        id: 1,
        src: "原文",
        dst: "",
        name_src: "原名",
        name_dst: null,
        status: "NONE",
        retry_count: 2,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
      },
    ]);
  }

  function read_items(database: ProjectDatabase, project_path: string): MutableJsonRecord[] {
    return database.get_all_items(project_path) as unknown as MutableJsonRecord[];
  }

  function read_meta(database: ProjectDatabase, project_path: string): MutableJsonRecord {
    return database.get_all_meta(project_path) as unknown as MutableJsonRecord;
  }

  function add_test_asset(
    database: ProjectDatabase,
    project_path: string,
    asset_path: string,
    content: string,
    sort_order: number,
  ): void {
    const source_path = path.join(path.dirname(project_path), `source-${asset_path}`);
    fs.writeFileSync(source_path, content);
    database.add_asset_from_source(project_path, asset_path, source_path, sort_order);
  }
});
