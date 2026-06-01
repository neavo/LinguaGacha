import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiJsonValue } from "../api/api-types";
import { ProjectDatabase } from "../database/database-operations";
import type { ProjectChangePublisher } from "./project-changes";
import { get_section_revision } from "./project-data";
import { ProjectEventBus } from "./project-events";
import { ProjectWriteStore } from "./project-write-store";
import { ZstdTool } from "../../shared/utils/zstd-tool";
import type { ProjectChangeEvent } from "../../shared/project-event";

type MutableJsonRecord = Record<string, ApiJsonValue>;

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
          dst: "译文",
          name_dst: ["译名"],
          status: "PROCESSED",
          retry_count: 0,
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
        targetProjectPath: project_path,
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: { payloadMode: "canonical-delta", changedIds: [1] },
      }),
    ]);
  });

  it("拒绝缺少 item_id 的任务 patch", async () => {
    const { project_path, store } = create_store("invalid-patch");

    await expect(
      store.apply_translation_item_patches({
        projectPath: project_path,
        items: [{ id: 1, dst: "旧契约" }],
        translationExtras: {},
      }),
    ).rejects.toThrow("runtime.internal_invariant");
  });

  it("校对字段 patch 会推进 proofreading revision 并更新翻译统计", async () => {
    const { database, project_path, store, published_changes } = create_store("proofreading");
    seed_items(database, project_path);
    database.execute({
      name: "upsertMetaEntries",
      args: {
        projectPath: project_path,
        meta: { translation_extras: { total_line: 1, processed_line: 0, error_line: 0, line: 0 } },
      },
    });

    await store.apply_proofreading_item_patch({
      projectPath: project_path,
      expectedSectionRevisions: { items: 0, proofreading: 0 },
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
      source: "proofreading_save_items",
      updatedSections: ["items", "proofreading"],
      items: {
        payloadMode: "field-patch",
        changedIds: [1],
        fieldPatch: { dst: "校对译文", status: "PROCESSED" },
      },
    });
  });

  it("提交工作台结构写入时替换事实并发布轻量失效信号", async () => {
    const { database, project_path, store, published_changes } = create_store("workbench");
    seed_items(database, project_path);
    database.execute({
      name: "addAssetCompressedBase64",
      args: {
        projectPath: project_path,
        path: "demo.txt",
        compressedBase64: ZstdTool.compress(Buffer.from("demo")).toString("base64"),
        originalSize: 4,
        sortOrder: 0,
      },
    });
    database.execute({
      name: "upsertAnalysisItemCheckpoints",
      args: {
        projectPath: project_path,
        checkpoints: [{ item_id: 1, status: "PROCESSED", updated_at: "now", error_count: 0 }],
      },
    });

    await store.replace_workbench_items_and_files({
      projectPath: project_path,
      expectedSectionRevisions: { files: 0, items: 0, analysis: 0 },
      revisionSections: ["files", "items", "analysis"],
      source: "workbench_delete_file",
      updatedSections: ["files", "items", "analysis"],
      assetWrites: [{ kind: "delete", path: "demo.txt" }],
      items: [],
      meta: { translation_extras: {}, analysis_candidate_count: 0 },
      resetAnalysis: true,
    });

    expect(database.execute({ name: "getAssetCount", args: { projectPath: project_path } })).toBe(
      0,
    );
    expect(read_items(database, project_path)).toEqual([]);
    expect(
      database.execute({ name: "getAnalysisItemCheckpoints", args: { projectPath: project_path } }),
    ).toEqual([]);
    expect(read_meta(database, project_path)).toMatchObject({
      "project_runtime_revision.files": 1,
      "project_runtime_revision.items": 1,
      "project_runtime_revision.analysis": 1,
    });
    expect(published_changes.at(-1)).toMatchObject({
      source: "workbench_delete_file",
      updatedSections: ["files", "items", "analysis"],
      items: { payloadMode: "section-invalidated" },
      files: { payloadMode: "section-invalidated" },
      sections: {
        analysis: { payloadMode: "canonical-delta" },
      },
    });
  });

  it("文件排序只发布 files 失效信号", async () => {
    const { database, project_path, store, published_changes } = create_store("reorder");
    database.execute({
      name: "addAssetCompressedBase64",
      args: {
        projectPath: project_path,
        path: "a.txt",
        compressedBase64: ZstdTool.compress(Buffer.from("a")).toString("base64"),
        originalSize: 1,
        sortOrder: 0,
      },
    });
    database.execute({
      name: "addAssetCompressedBase64",
      args: {
        projectPath: project_path,
        path: "b.txt",
        compressedBase64: ZstdTool.compress(Buffer.from("b")).toString("base64"),
        originalSize: 1,
        sortOrder: 1,
      },
    });

    await store.reorder_workbench_files({
      projectPath: project_path,
      expectedSectionRevisions: { files: 0 },
      orderedPaths: ["b.txt", "a.txt"],
    });

    expect(
      database.execute({ name: "getAllAssetRecords", args: { projectPath: project_path } }),
    ).toEqual([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
    ]);
    expect(published_changes.at(-1)).toMatchObject({
      source: "workbench_reorder_files",
      updatedSections: ["files"],
      files: { payloadMode: "section-invalidated" },
    });
    expect(published_changes.at(-1)).not.toHaveProperty("sections");
  });

  it("提交质量规则和提示词时写入各自 revision", async () => {
    const { database, project_path, store } = create_store("quality");

    await store.save_quality_rules({
      projectPath: project_path,
      expectedSectionRevisions: { quality: 0 },
      source: "quality_rule_save_entries",
      rule: {
        databaseType: "glossary",
        entries: [{ src: "姫", dst: "公主" }],
      },
      revisionKey: "quality_rule_revision.glossary",
    });
    await store.save_quality_prompt({
      projectPath: project_path,
      expectedSectionRevisions: { prompts: 0 },
      promptRuleType: "translation_prompt",
      text: "请翻译",
      revisionKey: "quality_prompt_revision.translation",
      enabledMetaKey: "translation_prompt_enable",
      enabled: true,
    });

    expect(
      database.execute({
        name: "getRules",
        args: { projectPath: project_path, ruleType: "glossary" },
      }),
    ).toEqual([{ src: "姫", dst: "公主" }]);
    expect(
      database.execute({
        name: "getRuleText",
        args: { projectPath: project_path, ruleType: "translation_prompt" },
      }),
    ).toBe("请翻译");
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
        { item_id: 1, status: "PROCESSED", updated_at: "2026-01-01T00:00:00.000Z" },
      ],
      errorCheckpoints: [],
      glossaryEntries: [{ src: "魔法", dst: "magic", info: "术语", case_sensitive: true }],
      progressSnapshot: { total_line: 1, line: 1, processed_line: 1 },
    });

    expect(ack).toMatchObject({
      inserted_count: 1,
      analysis_candidate_count: 1,
      section_revisions: { analysis: 1 },
    });
    expect(
      database.execute({ name: "getAnalysisItemCheckpoints", args: { projectPath: project_path } }),
    ).toEqual([
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

  function create_store(name: string): {
    database: ProjectDatabase;
    project_path: string;
    store: ProjectWriteStore;
    published_changes: MutableJsonRecord[];
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `linguagacha-write-${name}-`));
    const project_path = path.join(directory, `${name}.lg`);
    const database = new ProjectDatabase();
    const event_bus = new ProjectEventBus();
    const published_changes: MutableJsonRecord[] = [];
    database.execute({
      name: "createProject",
      args: { projectPath: project_path, name },
    });
    cleanup_callbacks.push(() => database.close());
    cleanup_callbacks.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    return {
      database,
      project_path,
      store: new ProjectWriteStore(
        database,
        event_bus,
        create_project_change_publisher(database, project_path, published_changes),
      ),
      published_changes,
    };
  }

  function create_project_change_publisher(
    database: ProjectDatabase,
    project_path: string,
    published_changes: MutableJsonRecord[],
  ): ProjectChangePublisher {
    return {
      publish_project_change: vi.fn((payload: MutableJsonRecord): ProjectChangeEvent => {
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
          projectPath: String(payload["targetProjectPath"] ?? ""),
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
      }),
    } as unknown as ProjectChangePublisher;
  }

  function seed_items(database: ProjectDatabase, project_path: string): void {
    database.execute({
      name: "setItems",
      args: {
        projectPath: project_path,
        items: [
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
        ],
      },
    });
  }

  function read_items(database: ProjectDatabase, project_path: string): MutableJsonRecord[] {
    return database.execute({
      name: "getAllItems",
      args: { projectPath: project_path },
    }) as unknown as MutableJsonRecord[];
  }

  function read_meta(database: ProjectDatabase, project_path: string): MutableJsonRecord {
    return database.execute({
      name: "getAllMeta",
      args: { projectPath: project_path },
    }) as unknown as MutableJsonRecord;
  }
});
