import { describe, expect, it } from "vitest";

import { CacheManager } from "../cache/cache-manager";
import { ProjectDatabase } from "../database/database-operations";
import { ProjectSessionState } from "../project/project-session";
import type { BackendWorkerClient } from "../worker/worker-client";
import { WorkbenchQueryService } from "./workbench-query-service";

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

describe("WorkbenchQueryService", () => {
  it("从 CacheManager 返回工作台 snapshot 与 revision", async () => {
    const { service } = await create_service([
      create_item({ id: 1, status: "PROCESSED" }),
      create_item({ id: 2, src: "失敗", status: "ERROR" }),
    ]);

    const result = service.read_workbench_snapshot();

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

  it("工作台 snapshot 按 asset sort_order 返回文件顺序", async () => {
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

    const result = service.read_workbench_snapshot();

    expect(result).toMatchObject({
      snapshot: {
        entries: [
          { rel_path: "b.txt", sort_index: 0, item_count: 1 },
          { rel_path: "a.txt", sort_index: 1, item_count: 1 },
        ],
      },
    });
  });

  it("工作台 snapshot 按分析 summary 与跳过项口径计算统计", async () => {
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

    const result = service.read_workbench_snapshot();

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

  it("工作台 snapshot 在旧工程缺少分析进度时按 item 口径回退", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "待分析", status: "NONE" }),
      create_item({ id: 2, src: "已跳过", status: "EXCLUDED" }),
    ]);

    const result = service.read_workbench_snapshot();

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

  it("返回自定义提示词查询视图与 prompts revision", async () => {
    const { service } = await create_service([]);

    const result = service.read_prompt_view({
      task_type: "translation",
    });

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: {
        prompts: 2,
      },
      prompt: {
        text: "翻译提示词",
        enabled: true,
        revision: 2,
      },
    });
  });

  it("默认预设事实热机后首次质量规则 query 返回 entries 与 revision", async () => {
    const { service } = await create_service([], [{ path: "script.txt", sort_order: 0 }], {
      "quality_rule_revision.glossary": 1,
    });

    const result = service.read_quality_rule_view({
      rule_type: "glossary",
    });

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: {
        quality: 1,
      },
      qualityRule: {
        enabled: true,
        revision: 1,
        entries: [{ src: "HP", dst: "生命值" }],
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
    service: WorkbenchQueryService;
  }> {
    // database fake 汇总项目 meta、资源、规则和提示词，避免测试绕过 CacheManager。
    const database = {
      execute(operation: { name: string; args?: Record<string, unknown> }) {
        if (operation.name === "getAllMeta") {
          return {
            "project_runtime_revision.items": 7,
            "project_runtime_revision.prompts": 3,
            "quality_rule_revision.glossary": 5,
            glossary_enable: true,
            text_preserve_mode: "smart",
            translation_prompt_enable: true,
            "quality_prompt_revision.translation": 2,
            ...meta_overrides,
          };
        }
        if (operation.name === "getAllItems") {
          return items;
        }
        if (operation.name === "getAllAssetRecords") {
          return asset_records;
        }
        if (operation.name === "getRules") {
          if (operation.args?.ruleType === "glossary") {
            return [{ src: "HP", dst: "生命值" }];
          }
          if (operation.args?.ruleType === "text_preserve") {
            return [{ src: "\\[[^\\]]+\\]" }];
          }
          return [];
        }
        if (operation.name === "getRuleText") {
          return operation.args?.ruleType === "translation_prompt" ? "翻译提示词" : "";
        }
        return null;
      },
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
      } as unknown as BackendWorkerClient,
    });
    await cache.warmProject("E:/Project/demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    return {
      service: new WorkbenchQueryService(session_state, cache),
    };
  }
});
