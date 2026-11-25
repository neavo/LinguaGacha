import type { ProjectCommittedChange } from "../project/project-committed-change";
import { create_item } from "../../domain/item";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectCache } from "../cache/project-cache";
import { ProjectDatabase } from "../database/database-operations";
import type { ProjectCommittedChangeHandler } from "../project/project-committed-change";
import { ProjectWriteStore } from "../project/project-write-store";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { BatchTranslationProjectStore } from "./batch-translation-project-store";

describe("BatchTranslationProjectStore", () => {
  const cleanup_callbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanup_callbacks.splice(0)) await cleanup();
  });

  it("提交翻译结果时写入 items 并发布行级 items 变更", async () => {
    const { database, project_path, store, published_changes } = await create_store();
    await seed_items(database, project_path);

    const ack = await store.commit_translation_batch(
      [
        {
          item_id: 1,
          dst: "译文",
          name_dst: "译名",
          status: "PROCESSED",
        },
      ],
      false,
    );

    expect(await database.get_all_items(project_path)).toEqual(
      [
        {
          id: 1,
          src: "原文",
          dst: "译文",
          name_src: "原名",
          name_dst: "译名",
          status: "PROCESSED",
          file_path: "demo.txt",
          file_type: "TXT",
          row: 7,
          extra_field: { speaker: "春" },
        },
        {
          id: 2,
          src: "待翻",
          dst: "",
          status: "NONE",
          file_path: "demo.txt",
          file_type: "TXT",
          row: 8,
        },
      ].map((item) => create_item(item)),
    );
    expect(ack).toEqual({
      changed_item_ids: [1],
      section_revisions: { items: 1 },
    });
    expect(published_changes).toMatchObject([
      {
        projectPath: project_path,
        source: "translation_batch_update",
        updatedSections: ["items"],
        items: { mode: "delta", records: [{ item_id: 1 }] },
      },
    ]);
  });

  it("重翻结果推进 proofreading revision 并返回已提交条目 id", async () => {
    const { database, project_path, store, published_changes } = await create_store();
    await seed_items(database, project_path);

    const ack = await store.commit_translation_batch(
      [
        {
          item_id: 2,
          dst: "重翻译文",
          status: "PROCESSED",
        },
      ],
      true,
    );

    const meta = await database.get_all_meta(project_path);
    expect(meta["proofreading_revision.proofreading"]).toBe(1);
    expect(meta["project_runtime_revision.items"]).toBe(1);
    expect(ack).toEqual({
      changed_item_ids: [2],
      section_revisions: { items: 1, proofreading: 1 },
    });
    expect(published_changes).toMatchObject([
      {
        projectPath: project_path,
        source: "retranslate_items",
        updatedSections: ["items", "proofreading"],
        items: { mode: "delta", records: [{ item_id: 2 }] },
      },
    ]);
  });

  it("构建任务质量快照时保留工程自定义提示词启用态", async () => {
    const { cache_manager, database, project_path, store } = await create_store();
    await database.transaction(project_path, (writer) =>
      writer.set_rule_text(project_path, "translation_prompt", "自定义翻译提示词"),
    );
    await database.transaction(project_path, (writer) =>
      writer.upsert_meta_entries(project_path, {
        translation_prompt_enable: true,

        "quality_prompt_revision.translation": 2,
      }),
    );
    await cache_manager.refresh();

    const snapshot = store.build_quality_snapshot();

    expect(snapshot).toMatchObject({
      translation_prompt: "自定义翻译提示词",
      translation_prompt_enable: true,
    });
  });

  it("任务提交等待内部事件完成后再发布公开项目变更", async () => {
    const calls: string[] = [];
    const { database, project_path, store } = await create_store({
      on_publish_project_change: () => calls.push("public"),
      on_project_event: async () => {
        calls.push("internal:start");
        await Promise.resolve();
        calls.push("internal:end");
      },
    });
    await seed_items(database, project_path);

    await store.commit_translation_batch(
      [
        {
          item_id: 1,
          dst: "译文",
          status: "PROCESSED",
        },
      ],
      false,
    );

    expect(calls).toEqual(["internal:start", "internal:end", "public"]);
  });

  /** 组合临时数据库和真实写入口，收集项目事件。 */
  async function create_store(
    options: {
      on_publish_project_change?: () => void;
      on_project_event?: ProjectCommittedChangeHandler;
    } = {},
  ): Promise<{
    database: ProjectDatabase;
    project_path: string;
    cache_manager: ProjectCache;
    store: BatchTranslationProjectStore;
    published_changes: ProjectCommittedChange[];
  }> {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-task-project-store-"));
    const project_path = path.join(directory, "task.lg");
    const database = new ProjectDatabase("1.0.0");
    const cache_manager = new ProjectCache({
      projectPath: project_path,
      database,
      logManager: null,
      workerClient: {
        run: async () => ({}),
        dispose: async () => undefined,
      } as unknown as ComputeWorkerClient,
    });
    const published_changes: ProjectCommittedChange[] = [];
    cleanup_callbacks.push(async () => {
      await database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    });
    await database.create_project(project_path);
    const write_store = new ProjectWriteStore(
      database,
      options.on_project_event ?? vi.fn(),
      (payload: ProjectCommittedChange) => {
        options.on_publish_project_change?.();
        published_changes.push(payload);
        return null;
      },
    );
    return {
      database,
      project_path,
      cache_manager,
      store: new BatchTranslationProjectStore(project_path, cache_manager, write_store),
      published_changes,
    };
  }

  /** 准备含已用字段的数据库条目，验证局部提交保留其它事实。 */
  async function seed_items(database: ProjectDatabase, project_path: string): Promise<void> {
    await database.transaction(project_path, (writer) =>
      writer.add_asset(project_path, "demo.txt", Buffer.from("原文"), "TXT"),
    );
    await database.transaction(project_path, (writer) =>
      writer.set_items(
        project_path,
        [
          {
            id: 1,
            src: "原文",
            dst: "",
            name_src: "原名",
            name_dst: null,
            status: "NONE",
            file_path: "demo.txt",
            file_type: "TXT",
            row: 7,
            extra_field: { speaker: "春" },
          },
          {
            id: 2,
            src: "待翻",
            dst: "",
            status: "NONE",
            file_path: "demo.txt",
            file_type: "TXT",
            row: 8,
          },
        ].map((item) => create_item(item)),
      ),
    );
  }
});
