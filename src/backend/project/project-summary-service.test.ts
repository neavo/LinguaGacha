import { describe, expect, it } from "vitest";

import { CacheManager } from "../cache/cache-manager";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectSessionState } from "./project-session-state";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import { ProjectSummaryService } from "./project-summary-service";

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
      snapshot: {
        file_count: 1,
        total_items: 2,
        translation_stats: {
          total_items: 2,
          completed_count: 1,
          failed_count: 1,
          pending_count: 0,
          completion_percent: 50,
        },
      },
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
          { rel_path: "b.txt", sort_index: 0, item_count: 1 },
          { rel_path: "a.txt", sort_index: 1, item_count: 1 },
        ],
      },
    });
  });

  it("项目摘要按分析进度与跳过项口径计算统计", async () => {
    const { service } = await create_service(
      [
        create_item({ id: 1, status: "PROCESSED" }),
        create_item({ id: 2, src: "跳过", status: "EXCLUDED" }),
        create_item({ id: 3, src: "待分析", status: "NONE" }),
        create_item({ id: 4, src: "分析失败", status: "NONE" }),
      ],
      [{ path: "script.txt", sort_order: 0 }],
      {
        analysis_extras: {
          total_line: 3,
          processed_line: 2,
          error_line: 1,
          line: 3,
        },
      },
    );

    const result = service.read();

    expect(result).toMatchObject({
      snapshot: {
        translation_stats: {
          total_items: 4,
          completed_count: 1,
          skipped_count: 1,
          completion_percent: 50,
        },
        analysis_stats: {
          total_items: 4,
          completed_count: 2,
          failed_count: 1,
          pending_count: 0,
          skipped_count: 1,
          completion_percent: 75,
        },
      },
    });
  });

  it("项目摘要在旧工程缺少分析进度时按 item 口径回退", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "待分析", status: "NONE" }),
      create_item({ id: 2, src: "已跳过", status: "EXCLUDED" }),
    ]);

    const result = service.read();

    expect(result).toMatchObject({
      snapshot: {
        analysis_stats: {
          total_items: 2,
          completed_count: 0,
          failed_count: 0,
          pending_count: 1,
          skipped_count: 1,
          completion_percent: 50,
        },
      },
    });
  });

  // 通过 CacheManager 热机后再构造 query service，覆盖首次页面 query 依赖的真实缓存路径。
  async function create_service(
    items: Record<string, unknown>[],
    asset_records: Array<{ path: string; sort_order: number }> = [
      { path: "script.txt", sort_order: 0 },
    ],
    meta_overrides: Record<string, unknown> = {},
  ): Promise<{
    service: ProjectSummaryService;
  }> {
    const database = {
      get_all_meta: () => ({
        "project_runtime_revision.items": 7,
        "project_runtime_revision.prompts": 3,
        "quality_rule_revision.glossary": 5,
        glossary_enable: true,
        text_preserve_mode: "smart",
        translation_prompt_enable: true,
        "quality_prompt_revision.translation": 2,
        ...meta_overrides,
      }),
      get_all_items: () => items,
      get_all_asset_records: () => asset_records,
      get_rules: (_project_path: string, rule_type: string) => {
        if (rule_type === "glossary") {
          return [{ entry_id: "hp", src: "HP", dst: "生命值" }];
        }
        if (rule_type === "text_preserve") {
          return [{ entry_id: "renpy", src: "\\[[^\\]]+\\]" }];
        }
        return [];
      },
      get_rule_text: (_project_path: string, rule_type: string) =>
        rule_type === "translation_prompt" ? "翻译提示词" : "",
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
