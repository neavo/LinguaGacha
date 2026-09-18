import { describe, expect, it, vi } from "vitest";

import type { AppSettingService } from "../app/app-setting-service";
import type { ProjectDatabase } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import {
  evaluateProofreadingSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-reader";
import { CacheManager } from "./cache-manager";
import { build_proofreading_page_row_id } from "../../shared/proofreading/proofreading-types";

type MutableRecord = Record<string, unknown>;

/** 提供数据库行，字段覆盖由各用例声明。 */
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

/** 隔离数据库访问，并记录全量与局部读取成本。 */
function create_database(
  options: {
    meta?: MutableRecord;
    items?: MutableRecord[];
    rules?: Record<string, MutableRecord[]>;
    throw_on_get_all_items?: boolean;
  } = {},
): ProjectDatabase & {
  get_all_items: ReturnType<typeof vi.fn>;
  get_items_by_ids: ReturnType<typeof vi.fn>;
  get_rules: ReturnType<typeof vi.fn>;
  get_rule_text: ReturnType<typeof vi.fn>;
} {
  const get_all_items = vi.fn(() => {
    if (options.throw_on_get_all_items) {
      throw new Error("items 读取失败");
    }
    return options.items ?? [];
  });
  const get_items_by_ids = vi.fn((_project_path: string, item_ids: number[]) => {
    const ids = new Set(item_ids);
    return (options.items ?? []).filter((item) =>
      ids.has(Number(item["id"] ?? item["item_id"] ?? 0)),
    );
  });
  const get_rules = vi.fn((_project_path: string, rule_type: string) => {
    return options.rules?.[rule_type] ?? [];
  });
  const get_rule_text = vi.fn(() => "");
  return {
    read_pdf_summaries: () => ({}),
    read_pdf_documents: vi.fn(() => []),
    get_all_meta: vi.fn(() => options.meta ?? {}),
    get_all_items,
    get_items_by_ids,
    get_all_asset_records: vi.fn(() => [{ path: "script.txt", sort_order: 0 }]),
    get_rules,
    get_rule_text,
  } as unknown as ProjectDatabase & {
    get_all_items: ReturnType<typeof vi.fn>;
    get_items_by_ids: ReturnType<typeof vi.fn>;
    get_rules: ReturnType<typeof vi.fn>;
    get_rule_text: ReturnType<typeof vi.fn>;
  };
}

/** 固定语言，避免依赖本机设置。 */
function create_settings(): AppSettingService {
  return {
    read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
  } as unknown as AppSettingService;
}

/** 使用真实评估函数，记录重算次数。 */
function create_worker(): ComputeWorkerClient & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (task: { type: string; input: ProofreadingSyncInput }) => {
      if (task.type === "proofreading_sync") {
        return evaluateProofreadingSlice(task.input);
      }
      return {};
    }),
    dispose: vi.fn(async () => undefined),
  } as unknown as ComputeWorkerClient & { run: ReturnType<typeof vi.fn> };
}

/** 用真实缓存组合根串联数据库替身与评估器。 */
function create_cache(options: {
  database: ProjectDatabase;
  logManager?: Pick<LogManager, "warning" | "error"> | null;
  worker?: ComputeWorkerClient;
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
    const quality_snapshot = cache.quality.readBlock();
    quality_snapshot["changed"] = true;
    expect(cache.quality.readBlock()).not.toHaveProperty("changed");
    expect(cache.files.readFileEntries()).toEqual([
      {
        rel_path: "script.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    ]);
  });

  it("文件重排只更新文件索引，复用文本评估和页面内容并使旧排序窗口失效", async () => {
    const database = create_database({
      items: [
        create_item({ id: 1, file_path: "b.txt", status: "PROCESSED", dst: "かな" }),
        create_item({ id: 2, file_path: "a.txt" }),
      ],
    });
    const assets = vi.spyOn(database, "get_all_asset_records").mockReturnValue([
      { path: "b.txt", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
      { path: "book.pdf", sort_order: 2 },
    ]);
    vi.spyOn(database, "read_pdf_summaries").mockReturnValue({
      "book.pdf": { pages: 1, translated_pages: 0, kept_pages: 0, omitted_pages: 0 },
    });
    const pages = vi.spyOn(database, "read_pdf_documents").mockReturnValue([
      {
        file_path: "book.pdf",
        document: {
          digest: "test",
          pages: [
            {
              page: 1,
              width: 100,
              height: 100,
              rotation: 0,
              label: null,
              translation: null,
              reviewed: false,
              notes: "",
            },
          ],
        },
      },
    ]);
    const worker = create_worker();
    const cache = create_cache({ database, worker });
    await cache.warmProject("E:/Project/demo.lg");
    const read_items = vi.spyOn(cache.items, "readItems");
    const initial = await cache.proofreading.sync({});
    const query = {
      filters: initial.data.defaultFilters,
      keyword: "",
      scope: "all" as const,
      is_regex: false,
      sort_state: null,
    };
    const old_view = await cache.proofreading.list(query);
    const warnings = await cache.proofreading.warningSummary();
    const epoch = cache.snapshot().epoch;
    expect(old_view.data.window_rows.map((row) => row.row_id)).toEqual([
      "1",
      "2",
      build_proofreading_page_row_id("book.pdf", 1),
    ]);
    database.get_rules.mockClear();
    database.get_rule_text.mockClear();
    assets.mockReturnValue([
      { path: "book.pdf", sort_order: 0 },
      { path: "a.txt", sort_order: 1 },
      { path: "b.txt", sort_order: 2 },
    ]);
    await cache.handleProjectEvent({
      type: "project.items.changed",
      projectPath: "E:/Project/demo.lg",
      source: "project_reorder_files",
      affectedSections: ["files"],
      sectionRevisions: { files: 1 },
      files: { payloadMode: "section-invalidated" },
      scope: "items-full",
    });
    const updated = await cache.proofreading.sync({});
    expect(updated.data.files.map((file) => file.file_path)).toEqual([
      "book.pdf",
      "a.txt",
      "b.txt",
    ]);
    expect(
      (await cache.proofreading.window({ view_id: old_view.data.view_id, start: 0, count: 10 }))
        .data.rows,
    ).toEqual([]);
    const next_view = await cache.proofreading.list({
      ...query,
      window_anchor: { row_id: "1", offset: 0 },
    });
    expect(next_view.data.window_start).toBe(2);
    expect(next_view.data.window_rows[0]?.row_id).toBe("1");
    expect((await cache.proofreading.warningSummary()).data).toEqual(warnings.data);
    expect(cache.snapshot().epoch).toBe(epoch);
    expect(database.get_all_items).toHaveBeenCalledTimes(1);
    expect(read_items).toHaveBeenCalledTimes(1);
    expect(database.get_rules).not.toHaveBeenCalled();
    expect(database.get_rule_text).not.toHaveBeenCalled();
    expect(pages).toHaveBeenCalledTimes(1);
    expect(worker.run).toHaveBeenCalledTimes(1);
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
    expect(cache.quality.readBlock()).toEqual({});
  });

  it("已提交 write 后缓存维护失败会进入可恢复状态，后续读取重新热机", async () => {
    const database = create_database({
      items: [create_item()],
    });
    const log_manager = { warning: vi.fn(), error: vi.fn() };
    const cache = create_cache({ database, logManager: log_manager });
    await cache.warmProject("E:/Project/demo.lg");
    database.get_all_items.mockImplementation(() => {
      throw new Error("items 读取失败");
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

    database.get_all_items.mockReturnValue([create_item({ id: 2, src: "こんばんは" })]);

    expect(cache.items.readItem(2)).toEqual(expect.objectContaining({ src: "こんばんは" }));
    expect(cache.snapshot()).toMatchObject({ freshness: "fresh", itemCount: 1 });
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
    database.get_all_items.mockClear();
    database.get_items_by_ids.mockClear();
    database.get_rules.mockClear();
    database.get_rule_text.mockClear();
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
    expect(database.get_items_by_ids).toHaveBeenCalledWith("E:/Project/demo.lg", [1]);
    expect(database.get_all_items).not.toHaveBeenCalled();
    expect(database.get_rules).not.toHaveBeenCalled();
    expect(database.get_rule_text).not.toHaveBeenCalled();
  });
});
