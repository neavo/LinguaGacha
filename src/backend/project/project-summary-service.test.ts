import type { JsonRecord } from "../../domain/json";
import type { ProjectDatabaseAccess } from "../database/database-operations";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build_project_committed_change } from "./project-committed-change";
import type { ProjectDataSection } from "../../shared/project-event";

import { ProjectCache } from "../cache/project-cache";
import { ProjectDatabase } from "../database/database-operations";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { ProjectSummaryService } from "./project-summary-service";

it("工作台同步读取提交缓存，文本提交及空文件删除与修订一致", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-summary-cache-"));
  const project = path.join(root, "test.lg");
  const database = new ProjectDatabase("1.0.0");
  const cache = new ProjectCache({
    projectPath: project,
    database,
    logManager: null,
    workerClient: {} as ComputeWorkerClient,
  });
  try {
    await database.create_project(project, (writer) => {
      writer.add_asset(project, "empty.txt", Buffer.from(""), "TXT");
      writer.add_asset(project, "script.txt", Buffer.from("こんにちは"), "TXT");
      writer.set_items(project, [create_item({})]);
    });
    await cache.refresh();
    const service = new ProjectSummaryService(project, cache);
    expect(service.read()).toMatchObject({
      projectPath: project,
      snapshot: {
        entries: [
          { rel_path: "empty.txt", progress: { total_items: 0 } },
          { rel_path: "script.txt" },
        ],
      },
    });
    const commit = async (
      sections: ProjectDataSection[],
      write: (writer: ProjectDatabaseAccess) => void,
    ) => {
      const change = await database.transaction(project, (writer) => {
        write(writer);
        const meta = writer.get_all_meta(project);
        return build_project_committed_change(
          writer,
          {
            projectPath: project,
            source: "test",
            updatedSections: sections,
            qualityStatisticsScope: "none",
            changedItemIds: [1],
          },
          meta,
        );
      });
      await cache.applyCommittedChange(change);
    };
    await commit(["items"], (writer) => {
      writer.patch_item_translation_fields(project, [
        { item_id: 1, next: { dst: "译文", name_dst: null, status: "PROCESSED" } },
      ]);
      writer.set_meta(project, "project_runtime_revision.items", 2);
    });
    expect(service.read().sectionRevisions.items).toBe(2);
    expect(service.read_translation_stats().stats.completed_count).toBe(1);
    await commit(["files"], (writer) => {
      writer.delete_asset(project, "empty.txt");
      writer.set_meta(project, "project_runtime_revision.files", 1);
    });
    expect(service.read()).toMatchObject({
      sectionRevisions: { files: 1, items: 2 },
      snapshot: { entries: [{ rel_path: "script.txt", progress: { completed_count: 1 } }] },
    });
  } finally {
    await database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// query service 测试只关心公开读取结果，item helper 提供稳定的最小项目行。
function create_item(overrides: JsonRecord): JsonRecord {
  return {
    id: 1,
    src: "こんにちは",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row: 0,
    file_type: "TXT",
    file_path: "script.txt",
    status: "NONE",
    skip_internal_filter: false,
    ...overrides,
  };
}

describe("ProjectSummaryService", () => {
  it("项目摘要按 asset sort_order 返回文件顺序", async () => {
    const { service } = await create_service(
      [
        create_item({ id: 1, file_path: "a.txt", src: "A" }),
        create_item({ id: 2, file_path: "b.txt", src: "B" }),
      ],
      [
        { path: "b.txt", sort_order: 0, file_type: "TXT" },
        { path: "a.txt", sort_order: 1, file_type: "TXT" },
      ],
    );

    const result = await service.read();

    expect(result).toMatchObject({
      snapshot: {
        entries: [
          { rel_path: "b.txt", sort_index: 0, progress: { total_items: 1 } },
          { rel_path: "a.txt", sort_index: 1, progress: { total_items: 1 } },
        ],
      },
    });
  });

  it("工程完成率包含成功与跳过，失败和待处理计入总量", async () => {
    const { service } = await create_service(
      [
        create_item({ id: 1, status: "PROCESSED" }),
        create_item({ id: 2, src: "跳过", status: "EXCLUDED" }),
        create_item({ id: 3, file_path: "waiting.txt", status: "NONE" }),
        create_item({ id: 4, src: "翻译失败", status: "NONE" }),
      ],
      [
        { path: "script.txt", sort_order: 0, file_type: "TXT" },
        { path: "waiting.txt", sort_order: 1, file_type: "TXT" },
      ],
    );

    const result = service.read_translation_stats();
    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      stats: {
        total_items: 4,
        completed_count: 1,
        skipped_count: 1,
        pending_count: 2,
        completion_percent: 50,
      },
    });
    expect((await service.read()).snapshot.entries.map((entry) => entry.progress)).toEqual([
      {
        total_items: 3,
        completed_count: 1,
        skipped_count: 1,
        pending_count: 1,
        completion_percent: 67,
      },
      {
        total_items: 1,
        completed_count: 0,
        skipped_count: 0,
        pending_count: 1,
        completion_percent: 0,
      },
    ]);
  });

  // 通过 ProjectCache 热机后再构造 query service，覆盖首次页面 query 依赖的真实缓存路径。
  async function create_service(
    items: Record<string, unknown>[],
    asset_records: Array<{ path: string; sort_order: number; file_type: string }> = [
      { path: "script.txt", sort_order: 0, file_type: "TXT" },
    ],
  ): Promise<{
    service: ProjectSummaryService;
  }> {
    const database = {
      async read<T>(_path: string, callback: (reader: ProjectDatabaseAccess) => T): Promise<T> {
        return callback(this as unknown as ProjectDatabaseAccess);
      },
      get_all_meta: () => ({
        "project_runtime_revision.items": 7,
      }),
      get_all_items: () => items,
      get_all_asset_records: () => asset_records,
      get_rules: () => [],
      get_rule_text: () => "",
    } as unknown as ProjectDatabase;
    const cache = new ProjectCache({
      projectPath: "E:/Project/demo.lg",
      database,
      logManager: null,
      workerClient: {
        run: async () => ({}),
        dispose: async () => undefined,
      } as unknown as ComputeWorkerClient,
    });
    await cache.refresh();
    return {
      service: new ProjectSummaryService("E:/Project/demo.lg", cache),
    };
  }
});
