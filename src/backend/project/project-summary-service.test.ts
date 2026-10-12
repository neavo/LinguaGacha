import { add_test_asset_from_source } from "../../test/asset-fixture";
import { fixture_file_type } from "../../test/asset-fixture";
import type { JsonRecord } from "../../domain/json";
import type { ProjectDatabaseAccess } from "../database/database-operations";
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProjectDatabaseAccess as DatabaseAccess } from "../database/database-operations";
import { build_project_committed_change } from "./project-committed-change";
import type { ProjectDataSection } from "../../shared/project-event";
import { create_pdf_fixture } from "../file/pdf/test-support";
import { read_pdf_document } from "../file/pdf/pdf-document";

import { CacheManager } from "../cache/cache-manager";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectSessionState } from "./project-session-state";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { ProjectSummaryService } from "./project-summary-service";
import type { PDFSummary } from "../../shared/pdf";

it("工作台同步读取提交缓存，PDF 修改、文本提交及文件删除与修订一致", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lg-summary-cache-"));
  const project = path.join(root, "test.lg");
  const source = path.join(root, "book.pdf");
  const bytes = create_pdf_fixture();
  fs.writeFileSync(source, bytes);
  const document = read_pdf_document(bytes);
  const database = new ProjectDatabase();
  const session = new ProjectSessionState();
  const cache = new CacheManager({
    database,
    logManager: null,
    appSettingService: { read_setting: () => ({}) } as never,
    workerClient: {} as ComputeWorkerClient,
  });
  const summaries = vi.spyOn(DatabaseAccess.prototype, "read_pdf_summaries");
  try {
    await database.create_project(project, "test", (writer) => {
      add_test_asset_from_source(writer, project, "book.pdf", source, document);
      writer.add_asset(project, "script.txt", Buffer.from("こんにちは"), "TXT", null);
      writer.set_items(project, [create_item({})]);
    });
    await cache.warmProject(project);
    expect(summaries).toHaveBeenCalledTimes(1);
    await session.mark_loaded(project);
    const service = new ProjectSummaryService(session, cache);
    summaries.mockClear();
    expect(service.read().snapshot.entries[0]?.progress.completed_count).toBe(0);
    expect(summaries).not.toHaveBeenCalled();
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
    await commit(["pdf"], (writer) => {
      writer.write_pdf_page(project, "book.pdf", {
        ...document.pages[0]!,
        translation: { kind: "keep", reason: "封面" },
      });
      writer.set_meta(project, "project_runtime_revision.pdf", 1);
    });
    expect(service.read()).toMatchObject({
      sectionRevisions: { pdf: 1 },
      snapshot: {
        entries: expect.arrayContaining([
          expect.objectContaining({ progress: expect.objectContaining({ skipped_count: 1 }) }),
        ]),
      },
    });
    expect(summaries).toHaveBeenCalledTimes(1);
    summaries.mockClear();
    await commit(["items"], (writer) => {
      writer.patch_item_translation_fields(project, [
        { item_id: 1, next: { dst: "译文", name_dst: null, status: "PROCESSED" } },
      ]);
      writer.set_meta(project, "project_runtime_revision.items", 2);
    });
    expect(service.read().sectionRevisions.items).toBe(2);
    expect(service.read_translation_stats().stats.completed_count).toBe(1);
    expect(summaries).not.toHaveBeenCalled();
    await commit(["files", "pdf"], (writer) => {
      writer.delete_asset(project, "book.pdf");
      writer.set_meta(project, "project_runtime_revision.files", 1);
      writer.set_meta(project, "project_runtime_revision.pdf", 2);
    });
    expect(service.read()).toMatchObject({
      sectionRevisions: { files: 1, pdf: 2, items: 2 },
      snapshot: { entries: [{ rel_path: "script.txt", progress: { completed_count: 1 } }] },
    });
    expect(cache.pdf.readBlock()).toEqual({});
    expect(summaries).toHaveBeenCalledTimes(1);
    cache.clearProject();
    expect(cache.pdf.readBlock()).toEqual({});
  } finally {
    summaries.mockRestore();
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
  it("从 CacheManager 返回项目摘要与 revision", async () => {
    const { service } = await create_service([
      create_item({ id: 1, status: "PROCESSED" }),
      create_item({ id: 2, src: "失敗", status: "ERROR" }),
    ]);

    const result = await service.read();

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 7 },
    });
  });

  it("项目摘要按 asset sort_order 返回文件顺序", async () => {
    const { service } = await create_service(
      [
        create_item({ id: 1, file_path: "a.txt", src: "A" }),
        create_item({ id: 2, file_path: "b.txt", src: "B" }),
      ],
      [
        { path: "b.txt", sort_order: 0 },
        { path: "a.txt", sort_order: 1 },
      ],
    );

    const result = await service.read();

    expect(result).toMatchObject({
      snapshot: {
        entries: [
          { rel_path: "b.txt", sort_index: 0, progress: { total_count: 1 } },
          { rel_path: "a.txt", sort_index: 1, progress: { total_count: 1 } },
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
        create_item({ id: 4, src: "翻译失败", status: "ERROR" }),
      ],
      [
        { path: "script.txt", sort_order: 0 },
        { path: "waiting.txt", sort_order: 1 },
      ],
    );

    const result = service.read_translation_stats();
    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      stats: {
        total_items: 4,
        completed_count: 1,
        skipped_count: 1,
        failed_count: 1,
        pending_count: 1,
        completion_percent: 50,
      },
    });
    expect((await service.read()).snapshot.entries.map((entry) => entry.progress)).toEqual([
      {
        unit: "line",
        total_count: 3,
        completed_count: 1,
        skipped_count: 1,
        failed_count: 1,
        pending_count: 0,
        completion_percent: 67,
      },
      {
        unit: "line",
        total_count: 1,
        completed_count: 0,
        skipped_count: 0,
        failed_count: 0,
        pending_count: 1,
        completion_percent: 0,
      },
    ]);
  });

  it("PDF 按原页汇总译稿、确认保留和省略，失败状态不适用", async () => {
    const { service } = await create_service([], [{ path: "book.pdf", sort_order: 0 }], {
      "book.pdf": { pages: 4, translated_pages: 1, omitted_pages: 1, kept_pages: 1 },
    });
    expect((await service.read()).snapshot.entries).toEqual([
      {
        rel_path: "book.pdf",
        file_type: "PDF",
        sort_index: 0,
        progress: {
          unit: "page",
          total_count: 4,
          completed_count: 1,
          skipped_count: 2,
          failed_count: null,
          pending_count: 1,
          completion_percent: 75,
        },
      },
    ]);
    expect(service.read_translation_stats().stats.total_items).toBe(0);
  });

  // 通过 CacheManager 热机后再构造 query service，覆盖首次页面 query 依赖的真实缓存路径。
  async function create_service(
    items: Record<string, unknown>[],
    asset_records: Array<{ path: string; sort_order: number }> = [
      { path: "script.txt", sort_order: 0 },
    ],
    pdf_summaries: Record<string, PDFSummary> = {},
  ): Promise<{
    service: ProjectSummaryService;
  }> {
    const database = {
      read_pdf_summaries: () => pdf_summaries,
      async read<T>(_path: string, callback: (reader: ProjectDatabaseAccess) => T): Promise<T> {
        return callback(this as unknown as ProjectDatabaseAccess);
      },
      get_all_meta: () => ({
        "project_runtime_revision.items": 7,
      }),
      get_all_items: () => items,
      get_all_asset_records: () =>
        asset_records.map((asset) => ({ ...asset, file_type: fixture_file_type(asset.path) })),
      get_rules: () => [],
      get_rule_text: () => "",
    } as unknown as ProjectDatabase;
    const cache = new CacheManager({
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
    await cache.warmProject("E:/Project/demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    return {
      service: new ProjectSummaryService(session_state, cache),
    };
  }
});
