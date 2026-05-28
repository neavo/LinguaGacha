import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import { AppSessionCache } from "./app-session-cache";

type MutableRecord = Record<string, unknown>;

function create_item(overrides: MutableRecord = {}): MutableRecord {
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

function create_database(
  options: {
    meta?: MutableRecord;
    items?: MutableRecord[];
    rules?: Record<string, MutableRecord[]>;
    throw_on_get_all_items?: boolean;
  } = {},
): ProjectDatabase & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn((operation: DatabaseOperation) => {
    if (operation.name === "getAllMeta") {
      return options.meta ?? {};
    }
    if (operation.name === "getAllItems") {
      if (options.throw_on_get_all_items) {
        throw new Error("items 读取失败");
      }
      return options.items ?? [];
    }
    if (operation.name === "getAllAssetRecords") {
      return [{ path: "script.txt", sort_order: 0 }];
    }
    if (operation.name === "getRules") {
      const rule_type = String(operation.args?.["ruleType"] ?? "");
      return options.rules?.[rule_type] ?? [];
    }
    if (operation.name === "getRuleText") {
      return "";
    }
    return null;
  });
  return { execute } as unknown as ProjectDatabase & { execute: ReturnType<typeof vi.fn> };
}

describe("AppSessionCache", () => {
  it("热机后缓存当前工程 items、质量块、提示词块和 section revision", async () => {
    const cache = new AppSessionCache(
      create_database({
        meta: {
          "project_runtime_revision.items": 2,
          "quality_rule_revision.glossary": 3,
          "quality_prompt_revision.translation": 4,
        },
        items: [create_item()],
      }),
    );

    await cache.warmProject("E:/Project/demo.lg");

    expect(cache.snapshot()).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      freshness: "fresh",
      itemCount: 1,
      sectionRevisions: {
        items: 2,
        quality: 3,
        prompts: 4,
      },
    });
    expect(cache.readItems()).toEqual([
      expect.objectContaining({
        item_id: 1,
        src: "こんにちは",
        file_path: "script.txt",
      }),
    ]);
    expect(cache.readPromptsBlock()).toHaveProperty("translation");
    expect(cache.readQualityBlock()).toHaveProperty("glossary");
    expect(cache.readAnalysisBlock()).toHaveProperty("status_summary");
    expect(cache.readFileEntries()).toEqual([
      {
        rel_path: "script.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    ]);
  });

  it("unload 事件只清理当前工程缓存", async () => {
    const cache = new AppSessionCache(create_database({ items: [create_item()] }));
    await cache.warmProject("E:/Project/demo.lg");

    await cache.handleAppEvent({
      type: "project.unloaded",
      projectPath: "E:/Project/demo.lg",
      source: "project_lifecycle",
      affectedSections: [],
      sectionRevisions: {},
    });

    expect(cache.snapshot()).toMatchObject({
      projectPath: "",
      freshness: "empty",
      itemCount: 0,
    });
  });

  it("已提交 mutation 后缓存维护失败会进入可恢复状态，后续读取重新热机", async () => {
    const database = create_database({
      items: [create_item()],
    });
    const log_manager = { warning: vi.fn(), error: vi.fn() };
    const cache = new AppSessionCache(database, log_manager);
    await cache.warmProject("E:/Project/demo.lg");
    database.execute.mockImplementation((operation: DatabaseOperation) => {
      if (operation.name === "getAllItems") {
        throw new Error("items 读取失败");
      }
      if (operation.name === "getAllAssetRecords") {
        return [{ path: "script.txt", sort_order: 0 }];
      }
      if (operation.name === "getRules") {
        return [];
      }
      if (operation.name === "getRuleText") {
        return "";
      }
      return {};
    });

    await cache.handleAppEvent({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "project_mutation",
      affectedSections: ["items"],
      sectionRevisions: { items: 2 },
      scope: "items-full",
    });

    expect(cache.snapshot().freshness).toBe("recoverable_error");
    expect(log_manager.warning).toHaveBeenCalled();

    database.execute.mockImplementation((operation: DatabaseOperation) => {
      if (operation.name === "getAllItems") {
        return [create_item({ id: 2, src: "こんばんは" })];
      }
      if (operation.name === "getAllAssetRecords") {
        return [{ path: "script.txt", sort_order: 0 }];
      }
      if (operation.name === "getRules") {
        return [];
      }
      if (operation.name === "getRuleText") {
        return "";
      }
      return { "project_runtime_revision.items": 2 };
    });

    expect(cache.readItem(2)).toEqual(expect.objectContaining({ src: "こんばんは" }));
    expect(cache.snapshot()).toMatchObject({ freshness: "fresh", itemCount: 1 });
  });

  it("热机时计算质量规则统计命中数", async () => {
    const cache = new AppSessionCache(
      create_database({
        items: [create_item({ id: 1, src: "Hero ẞ" }), create_item({ id: 2, src: "hero ss" })],
        rules: {
          glossary: [{ entry_id: "term.hero", src: "hero ss", case_sensitive: false }],
        },
      }),
    );

    await cache.warmProject("E:/Project/demo.lg");

    expect(cache.readQualityStatistics("glossary")).toMatchObject({
      phase: "current",
      completed_entry_ids: ["term.hero"],
      matched_count_by_entry_id: {
        "term.hero": 2,
      },
    });
  });
});
