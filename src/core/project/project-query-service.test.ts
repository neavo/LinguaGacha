import { describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { AppSessionCache } from "../app/app-session-cache";
import { ProjectSessionState } from "./project-session-state";
import { ProjectQueryService } from "./project-query-service";

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

describe("ProjectQueryService", () => {
  it("从 AppSessionCache 返回工作台 view model 与 revision", async () => {
    const { service } = await create_service([
      create_item({ id: 1, status: "PROCESSED" }),
      create_item({ id: 2, src: "失敗", status: "ERROR" }),
    ]);

    const result = service.read_workbench_view();

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 7 },
      view: {
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

  it("工作台 view model 按 asset sort_order 返回文件顺序", async () => {
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

    const result = service.read_workbench_view();

    expect(result).toMatchObject({
      view: {
        entries: [
          { rel_path: "b.txt", sort_index: 0, item_count: 1 },
          { rel_path: "a.txt", sort_index: 1, item_count: 1 },
        ],
      },
    });
  });

  it("工作台 view model 按分析 summary 与跳过项口径计算统计", async () => {
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

    const result = service.read_workbench_view();

    expect(result).toMatchObject({
      view: {
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

  it("工作台 view model 在旧工程缺少分析进度时按 item 口径回退", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "待分析", status: "NONE" }),
      create_item({ id: 2, src: "已跳过", status: "EXCLUDED" }),
    ]);

    const result = service.read_workbench_view();

    expect(result).toMatchObject({
      view: {
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

  it("按关键词和窗口返回校对基础列表", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "apple", dst: "苹果" }),
      create_item({ id: 2, src: "banana", dst: "香蕉" }),
    ]);

    const result = service.read_proofreading_view({
      keyword: "香",
      scope: "dst",
      window_start: 0,
      window_count: 1,
    });

    expect(result).toMatchObject({
      view: {
        row_count: 1,
        window_start: 0,
        window_rows: [
          {
            row_id: "2",
            warnings: [],
            item: { item_id: 2, src: "banana", dst: "香蕉" },
          },
        ],
      },
    });
  });

  it("按 row id 返回校对 mutation 所需 item 快照", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "apple", dst: "苹果", retry_count: 2 }),
      create_item({ id: 2, src: "banana", dst: "香蕉" }),
    ]);

    const result = service.read_proofreading_view({
      row_ids: ["1", "missing"],
    });

    expect(result).toMatchObject({
      sectionRevisions: { items: 7 },
      rows: [
        {
          row_id: "1",
          item: {
            item_id: 1,
            src: "apple",
            dst: "苹果",
            retry_count: 2,
          },
        },
      ],
    });
  });

  it("返回校对运行态 hydrate 所需完整快照", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "apple", dst: "苹果", retry_count: 2 }),
    ]);

    const result = service.read_proofreading_view({
      runtime_snapshot: true,
    });

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: {
        items: 7,
        quality: 5,
      },
      runtimeSnapshot: {
        total_item_count: 1,
        items: [
          {
            item_id: 1,
            src: "apple",
            dst: "苹果",
            retry_count: 2,
          },
        ],
        quality: {
          glossary: {
            entries: [{ src: "HP", dst: "生命值" }],
          },
        },
      },
    });
  });

  it("返回自定义提示词 query view 与 prompts revision", async () => {
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

  it("返回质量规则 query view 与规则 revision", async () => {
    const { service } = await create_service([]);

    const result = service.read_quality_rule_view({
      rule_type: "glossary",
    });

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: {
        quality: 5,
      },
      qualityRule: {
        enabled: true,
        revision: 5,
        entries: [{ src: "HP", dst: "生命值" }],
      },
    });
  });

  it("返回简繁转换 query view 所需条目和文本保护规则", async () => {
    const { service } = await create_service([
      create_item({ id: 1, dst: "后台", text_type: "NONE" }),
    ]);

    const result = service.read_ts_conversion_view();

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: {
        items: 7,
        quality: 5,
      },
      items: [
        {
          item_id: 1,
          dst: "后台",
          text_type: "NONE",
        },
      ],
      textPreserve: {
        mode: "smart",
        revision: 5,
        entries: [{ src: "\\[[^\\]]+\\]" }],
      },
    });
  });

  it("返回姓名字段提取 query view 所需条目和术语表", async () => {
    const { service } = await create_service([
      create_item({ id: 1, src: "Alice says hello", name_src: "Alice" }),
    ]);

    const result = service.read_name_field_extraction_view();

    expect(result).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: {
        items: 7,
        quality: 5,
      },
      items: [
        {
          item_id: 1,
          src: "Alice says hello",
          name_src: "Alice",
        },
      ],
      glossary: {
        revision: 5,
        entries: [{ src: "HP", dst: "生命值" }],
      },
    });
  });

  async function create_service(
    items: Record<string, unknown>[],
    asset_records: Array<{ path: string; sort_order: number }> = [
      { path: "script.txt", sort_order: 0 },
    ],
    meta_overrides: Record<string, unknown> = {},
  ): Promise<{
    service: ProjectQueryService;
  }> {
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
    const cache = new AppSessionCache(database);
    await cache.warmProject("E:/Project/demo.lg");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    return {
      service: new ProjectQueryService(session_state, cache),
    };
  }
});
