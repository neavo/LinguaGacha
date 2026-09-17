import { describe, expect, it } from "vitest";

import { CacheManager } from "../cache/cache-manager";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectSessionState } from "./project-session-state";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { ProjectSummaryService } from "./project-summary-service";
import type { PDFSummary } from "../../shared/pdf";

// query service 测试只关心公开读取结果，item helper 提供稳定的最小项目行。
function create_item(overrides: Record<string, unknown>): Record<string, unknown> {
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
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
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

    const result = service.read();

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

    const result = service.read();

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
      [{ path: "script.txt", sort_order: 0 }],
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
    expect(service.read().snapshot.entries.map((entry) => entry.progress)).toEqual([
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

  it("PDF 使用原页的译稿与省略统计，核对数量不影响进度且失败状态不适用", async () => {
    const { service } = await create_service([], [{ path: "book.pdf", sort_order: 0 }], {
      "book.pdf": { pages: 3, translated_pages: 1, omitted_pages: 1, reviewed_pages: 3 },
    });
    expect(service.read().snapshot.entries).toEqual([
      {
        rel_path: "book.pdf",
        file_type: "PDF",
        sort_index: 0,
        progress: {
          unit: "page",
          total_count: 3,
          completed_count: 1,
          skipped_count: 1,
          failed_count: null,
          pending_count: 1,
          completion_percent: 67,
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
      get_all_meta: () => ({
        "project_runtime_revision.items": 7,
      }),
      get_all_items: () => items,
      get_all_asset_records: () => asset_records,
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
      service: new ProjectSummaryService(session_state, cache, database),
    };
  }
});
