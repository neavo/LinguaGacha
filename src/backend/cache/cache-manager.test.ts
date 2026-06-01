import { describe, expect, it, vi } from "vitest";

import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import type { DatabaseOperation } from "../database/database-types";
import type { LogManager } from "../log/log-manager";
import { ProjectEventBus } from "../project/project-events";
import type { BackendWorkerClient } from "../worker/worker-client";
import {
  evaluateProofreadingSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-list-reader";
import { CacheManager } from "./cache-manager";

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
    if (operation.name === "getItemsByIds") {
      const item_ids = Array.isArray(operation.args?.["itemIds"])
        ? new Set(operation.args["itemIds"].map((item_id) => Number(item_id)))
        : new Set<number>();
      return (options.items ?? []).filter((item) => {
        return item_ids.has(Number(item["id"] ?? item["item_id"] ?? 0));
      });
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

function create_settings(): AppSettingService {
  return {
    read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
  } as unknown as AppSettingService;
}

function create_worker(): BackendWorkerClient & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (task: { type: string; input: ProofreadingSyncInput }) => {
      if (task.type === "proofreading_sync") {
        return evaluateProofreadingSlice(task.input);
      }
      return {};
    }),
    dispose: vi.fn(async () => undefined),
  } as unknown as BackendWorkerClient & { run: ReturnType<typeof vi.fn> };
}

function create_cache(options: {
  database: ProjectDatabase;
  logManager?: Pick<LogManager, "warning" | "error"> | null;
  worker?: BackendWorkerClient;
}): CacheManager {
  return new CacheManager({
    database: options.database,
    logManager: options.logManager ?? null,
    appSettingService: create_settings(),
    workerClient: options.worker ?? create_worker(),
  });
}

describe("CacheManager", () => {
  it("热机后缓存当前工程 items、质量块、提示词块和 section revision", async () => {
    const cache = create_cache({
      database: create_database({
        meta: {
          "project_runtime_revision.items": 2,
          "quality_rule_revision.glossary": 3,
          "quality_prompt_revision.translation": 4,
        },
        items: [create_item()],
      }),
    });

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
    expect(cache.items.readItems()).toEqual([
      expect.objectContaining({
        item_id: 1,
        src: "こんにちは",
        file_path: "script.txt",
      }),
    ]);
    expect(cache.prompts.readBlock()).toHaveProperty("translation");
    expect(cache.quality.readBlock()).toHaveProperty("glossary");
    expect(cache.analysis.readBlock()).toHaveProperty("status_summary");
    expect(cache.files.readFileEntries()).toEqual([
      {
        rel_path: "script.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    ]);
  });

  it("unload 事件只清理当前工程缓存", async () => {
    const cache = create_cache({ database: create_database({ items: [create_item()] }) });
    await cache.warmProject("E:/Project/demo.lg");

    await cache.handleProjectEvent({
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

  it("已提交 write 后缓存维护失败会进入可恢复状态，后续读取重新热机", async () => {
    const database = create_database({
      items: [create_item()],
    });
    const log_manager = { warning: vi.fn(), error: vi.fn() };
    const cache = create_cache({ database, logManager: log_manager });
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

    await cache.handleProjectEvent({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "project_write",
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

    expect(cache.items.readItem(2)).toEqual(expect.objectContaining({ src: "こんばんは" }));
    expect(cache.snapshot()).toMatchObject({ freshness: "fresh", itemCount: 1 });
  });

  it("热机时只保留质量规则事实，不同步预计算统计", async () => {
    const cache = create_cache({
      database: create_database({
        items: [create_item({ id: 1, src: "Hero ẞ" }), create_item({ id: 2, src: "hero ss" })],
        rules: {
          glossary: [{ entry_id: "term.hero", src: "hero ss", case_sensitive: false }],
        },
      }),
    });

    await cache.warmProject("E:/Project/demo.lg");

    expect(cache.quality.readBlock()).toMatchObject({
      glossary: {
        entries: [{ entry_id: "term.hero", src: "hero ss", case_sensitive: false }],
      },
    });
  });

  it("items partial 事件只回读变化条目并更新基础缓存", async () => {
    const items = [
      create_item({ id: 1, src: "こんにちは", dst: "" }),
      create_item({ id: 2, src: "こんばんは", dst: "" }),
    ];
    const database = create_database({
      meta: { "project_runtime_revision.items": 1 },
      items,
    });
    const cache = create_cache({ database });
    await cache.warmProject("E:/Project/demo.lg");
    database.execute.mockClear();
    items[0] = create_item({ id: 1, src: "こんにちは", dst: "你好" });

    await cache.handleProjectEvent({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "translation_commit",
      affectedSections: ["items"],
      sectionRevisions: { items: 2 },
      items: { payloadMode: "canonical-delta", changedIds: [1] },
      scope: "items-partial",
    });

    expect(cache.snapshot()).toMatchObject({
      freshness: "fresh",
      itemCount: 2,
      sectionRevisions: { items: 2 },
    });
    expect(cache.items.readItem(1)).toEqual(expect.objectContaining({ dst: "你好" }));
    expect(cache.items.readItem(2)).toEqual(expect.objectContaining({ src: "こんばんは" }));
    expect(database.execute).toHaveBeenCalledWith({
      name: "getItemsByIds",
      args: { projectPath: "E:/Project/demo.lg", itemIds: [1] },
    });
    expect(database.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "getAllItems" }),
    );
    expect(database.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "getRules" }),
    );
    expect(database.execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "getRuleText" }),
    );
  });

  it("事件订阅统一维护基础缓存并清理受影响计算缓存", async () => {
    const database = create_database({
      items: [create_item()],
    });
    const cache = create_cache({ database });
    const event_bus = new ProjectEventBus();
    const proofreading_clear = vi.spyOn(cache.proofreading, "clearProject");
    const statistics_clear = vi.spyOn(cache.qualityStatistics, "clear");

    cache.subscribe(event_bus);
    await event_bus.publish({
      type: "project.opened_for_cache",
      projectPath: "E:/Project/demo.lg",
      source: "project_lifecycle",
      affectedSections: [
        "project",
        "files",
        "items",
        "quality",
        "prompts",
        "analysis",
        "proofreading",
      ],
      sectionRevisions: { items: 1 },
    });

    expect(cache.snapshot()).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      freshness: "fresh",
      itemCount: 1,
    });
    expect(proofreading_clear).toHaveBeenCalledWith();
    expect(statistics_clear).toHaveBeenCalledTimes(1);

    await event_bus.publish({
      type: "project.prompts.changed",
      projectPath: "E:/Project/demo.lg",
      source: "project_write",
      affectedSections: ["prompts"],
      sectionRevisions: { prompts: 2 },
      scope: "prompts-full",
    });

    expect(proofreading_clear).toHaveBeenCalledTimes(1);
    expect(statistics_clear).toHaveBeenCalledTimes(1);
  });
});
