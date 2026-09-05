import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../../domain/json";
import { CacheManager } from "../cache/cache-manager";
import { ProjectDatabase } from "../database/database-operations";
import type { ProjectEventHandler } from "../project/project-events";
import { ProjectWriteStore } from "../project/project-write-store";
import { ProjectSessionState } from "../project/project-session-state";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import type { MutableJsonRecord } from "../../domain/json";
import { BatchTranslationProjectStore } from "./batch-translation-project-store";

describe("BatchTranslationProjectStore", () => {
  const cleanup_callbacks: Array<() => void> = [];

  afterEach(() => {
    vi.useRealTimers();
    while (cleanup_callbacks.length > 0) {
      cleanup_callbacks.pop()?.();
    }
  });

  it("提交翻译结果时写入 items、进度 meta 并发布行级 items 变更", async () => {
    const { database, project_path, store, published_changes } = create_store();
    seed_items(database, project_path);

    const ack = await store.commit_translation_items(
      [
        {
          item_id: 1,
          dst: "译文",
          name_dst: "译名",
          status: "PROCESSED",
          retry_count: 0,
        },
      ],
      create_progress_snapshot({ line: 1, processed_line: 1 }),
      false,
    );

    expect(read_items(database, project_path)).toEqual([
      {
        id: 1,
        src: "原文",
        dst: "译文",
        name_src: "原名",
        name_dst: "译名",
        status: "PROCESSED",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 7,
        extra_field: { speaker: "春" },
      },
      {
        id: 2,
        src: "待翻",
        dst: "",
        status: "NONE",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 8,
      },
    ]);
    expect(read_meta(database, project_path)["translation_extras"]).toEqual(
      create_progress_snapshot({ line: 1, processed_line: 1 }),
    );
    expect(ack).toEqual({
      changed_item_ids: [1],
      section_revisions: { items: 1 },
    });
    expect(published_changes).toEqual([
      {
        projectPath: project_path,
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: {
          payloadMode: "canonical-delta",
          changedIds: [1],
        },
      },
    ]);
  });

  it("重翻结果推进 proofreading revision 并返回已提交条目 id", async () => {
    const { database, project_path, store, published_changes } = create_store();
    seed_items(database, project_path);

    const ack = await store.commit_translation_items(
      [
        {
          item_id: 2,
          dst: "重翻译文",
          status: "PROCESSED",
          retry_count: 0,
        },
      ],
      create_progress_snapshot({ line: 1, processed_line: 1 }),
      true,
    );

    const meta = read_meta(database, project_path);
    expect(meta["proofreading_revision.proofreading"]).toBe(1);
    expect(meta["project_runtime_revision.items"]).toBe(1);
    expect(ack).toEqual({
      changed_item_ids: [2],
      section_revisions: { items: 1, proofreading: 1 },
    });
    expect(published_changes).toEqual([
      {
        projectPath: project_path,
        source: "retranslate_items",
        updatedSections: ["items", "proofreading"],
        items: {
          payloadMode: "canonical-delta",
          changedIds: [2],
        },
      },
    ]);
  });

  it("构建任务质量快照时保留工程自定义提示词启用态", async () => {
    const { cache_manager, database, project_path, store } = create_store();
    database.set_rule_text(project_path, "translation_prompt", "自定义翻译提示词");
    database.upsert_meta_entries(project_path, {
      translation_prompt_enable: true,

      "quality_prompt_revision.translation": 2,
    });
    await cache_manager.warmProject(project_path);

    const snapshot = store.build_quality_snapshot();

    expect(snapshot).toMatchObject({
      translation_prompt: "自定义翻译提示词",
      translation_prompt_enable: true,
    });
  });

  it("构建任务质量快照时术语表缺启用 meta 仍按领域默认值启用", async () => {
    const { cache_manager, database, project_path, store } = create_store();
    database.set_rules(project_path, "glossary", [{ entry_id: "hp", src: "HP", dst: "生命值" }]);
    await cache_manager.warmProject(project_path);

    const snapshot = store.build_quality_snapshot();

    expect(snapshot.glossary_enable).toBe(true);
    expect(snapshot.glossary_entries).toEqual([
      { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false },
    ]);
  });

  it("任务提交等待内部事件完成后再发布公开项目变更", async () => {
    const calls: string[] = [];
    const { database, project_path, store } = create_store({
      on_publish_project_change: () => calls.push("public"),
      on_project_event: async () => {
        calls.push("internal:start");
        await Promise.resolve();
        calls.push("internal:end");
      },
    });
    seed_items(database, project_path);

    await store.commit_translation_items(
      [
        {
          item_id: 1,
          dst: "译文",
          status: "PROCESSED",
          retry_count: 0,
        },
      ],
      create_progress_snapshot({ line: 1, processed_line: 1 }),
      false,
    );

    expect(calls).toEqual(["internal:start", "internal:end", "public"]);
  });

  function create_store(
    options: {
      on_publish_project_change?: () => void;
      on_project_event?: ProjectEventHandler;
    } = {},
  ): {
    database: ProjectDatabase;
    project_path: string;
    cache_manager: CacheManager;
    store: BatchTranslationProjectStore;
    published_changes: MutableJsonRecord[];
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-task-project-store-"));
    const project_path = path.join(directory, "task.lg");
    const database = new ProjectDatabase();
    const session_state = new ProjectSessionState();
    const cache_manager = new CacheManager({
      database,
      logManager: null,
      appSettingService: {
        read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
      } as never,
      workerClient: {
        run: async () => ({}),
        dispose: async () => undefined,
      } as unknown as ComputeWorkerClient,
    });
    const published_changes: MutableJsonRecord[] = [];
    database.create_project(project_path, "task");
    session_state.mark_loaded(project_path);
    cleanup_callbacks.push(() => fs.rmSync(directory, { recursive: true, force: true }));
    cleanup_callbacks.push(() => database.close());
    const write_store = new ProjectWriteStore(
      database,
      options.on_project_event ?? vi.fn(),
      (payload: MutableJsonRecord) => {
        options.on_publish_project_change?.();
        published_changes.push(payload);
        return null;
      },
    );
    return {
      database,
      project_path,
      cache_manager,
      store: new BatchTranslationProjectStore(database, session_state, cache_manager, write_store),
      published_changes,
    };
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
        extra_field: { speaker: "春" },
      },
      {
        id: 2,
        src: "待翻",
        dst: "",
        status: "NONE",
        retry_count: 0,
        file_path: "demo.txt",
        file_type: "TXT",
        text_type: "TXT",
        row: 8,
      },
    ]);
  }

  function create_progress_snapshot(
    overrides: Partial<import("../../domain/batch-translation").BatchTranslationProgress> = {},
  ): import("../../domain/batch-translation").BatchTranslationProgress {
    return {
      start_time: 10,
      time: 0,
      total_line: 2,
      line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 3,
      total_input_tokens: 1,
      total_reasoning_tokens: 0,
      total_output_tokens: 2,
      ...overrides,
    };
  }

  function read_items(database: ProjectDatabase, project_path: string): JsonValue {
    return database.get_all_items(project_path);
  }

  function read_meta(database: ProjectDatabase, project_path: string): MutableJsonRecord {
    return database.get_all_meta(project_path) as unknown as MutableJsonRecord;
  }
});
