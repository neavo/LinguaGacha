import { ProjectDataReader } from "../project/project-data-reader";
import { describe, expect, it, vi } from "vitest";

import type { ProjectDatabase, ProjectDatabaseAccess } from "../database/database-operations";
import type { LogManager } from "../log/log-manager";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import {
  evaluateProofreadingSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-reader";
import { build_project_committed_change } from "../project/project-committed-change";
import { ProjectCache } from "./project-cache";

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
    status: "NONE",
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
): ProjectDatabaseAccess & {
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
  const get_rule_text = vi.fn(() => null);
  const access = {
    get_all_meta: vi.fn(() => options.meta ?? {}),
    get_all_items,
    get_items_by_ids,
    get_all_asset_records: vi.fn(() => [{ path: "script.txt", sort_order: 0, file_type: "TXT" }]),
    get_rules,
    get_rule_text,
  } as unknown as ProjectDatabaseAccess & {
    get_all_items: ReturnType<typeof vi.fn>;
    get_items_by_ids: ReturnType<typeof vi.fn>;
    get_rules: ReturnType<typeof vi.fn>;
    get_rule_text: ReturnType<typeof vi.fn>;
  };
  return Object.assign(access, {
    read: async <T>(_path: string, callback: (reader: ProjectDatabaseAccess) => T) =>
      callback(access),
  });
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
  database: ProjectDatabaseAccess;
  logManager?: Pick<LogManager, "warning" | "error"> | null;
  worker?: ComputeWorkerClient;
  projectPath?: string;
}): ProjectCache {
  const projectPath = options.projectPath ?? "E:/Project/demo.lg";
  return new ProjectCache({
    projectPath,
    projectId: "fixture",
    snapshot: new ProjectDataReader(options.database).read_snapshot(projectPath),
    database: options.database as unknown as ProjectDatabase,
    logManager: options.logManager ?? null,
    workerClient: options.worker ?? create_worker(),
  });
}

describe("ProjectCache", () => {
  it("项目语言随提交更新，缓存同步失败后从已提交事实恢复", async () => {
    const project = "E:/Project/languages.lg";
    const meta = {
      source_language: "EN",
      target_language: "KO",
      "project_runtime_revision.project": 0,
    };
    const database = create_database({ meta });
    const cache = create_cache({ database, projectPath: project });
    expect(cache.languages.readBlock()).toEqual({ source_language: "EN", target_language: "KO" });

    meta.target_language = "DE";
    meta["project_runtime_revision.project"] = 1;
    const committed = build_project_committed_change(
      database,
      {
        projectPath: project,
        source: "project_settings_update",
        updatedSections: ["project"],
        qualityStatisticsScope: "none",
      },
      meta,
    );
    vi.spyOn(cache.languages, "replace").mockImplementationOnce(() => {
      throw new Error("language sync failed");
    });
    await expect(cache.applyCommittedChange(committed)).rejects.toThrow("language sync failed");
    expect(cache.snapshot().freshness).toBe("fresh");
    expect(cache.languages.readBlock()).toEqual({ source_language: "EN", target_language: "DE" });
    expect(cache.readSectionRevisions().project).toBe(1);
  });

  it("已提交快照安装失败后阻止读取，重新热机恢复完整事实", async () => {
    const project = "E:/Project/demo.lg";
    const database = create_database({ items: [create_item()] });
    const cache = create_cache({ database });
    const snapshot = new ProjectDataReader(database).read_snapshot(project);
    vi.spyOn(cache.files, "replace").mockImplementationOnce(() => {
      throw new Error("install failed");
    });
    await expect(cache.refresh()).rejects.toThrow("install failed");
    expect(cache.snapshot().freshness).toBe("recoverable_error");
    expect(() => cache.items.readItems()).toThrow(
      expect.objectContaining({ code: "data.committed_sync_failed" }),
    );
    await cache.refresh();
    expect(cache.items.readItems()).toEqual(snapshot.items);
    expect(cache.files.readFileEntries()).toEqual(Object.values(snapshot.files));
    expect(cache.snapshot()).toMatchObject({
      freshness: "fresh",
      sectionRevisions: snapshot.section_revisions,
    });
  });

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
    expect(cache.prompts.readBlock().translation.text).toBeNull();
    expect(cache.quality.readBlock()).toHaveProperty("glossary");
    const quality_snapshot = cache.quality.readBlock();
    quality_snapshot.glossary = {
      ...quality_snapshot.glossary,
      enabled: !quality_snapshot.glossary.enabled,
    };
    expect(cache.quality.readBlock().glossary.enabled).not.toBe(quality_snapshot.glossary.enabled);
    expect(cache.files.readFileEntries()).toEqual([
      {
        rel_path: "script.txt",
        file_type: "TXT",
        sort_index: 0,
      },
    ]);
  });

  it("已提交 write 后缓存维护失败会等待重新热机再报告原始错误", async () => {
    const database = create_database({
      items: [create_item()],
    });
    const log_manager = { warning: vi.fn(), error: vi.fn() };
    const cache = create_cache({ database, logManager: log_manager });
    const meta = {
      "project_runtime_revision.items": 2,
      "quality_rule_revision.glossary": 3,
      "quality_prompt_revision.translation": 4,
    };
    vi.spyOn(database, "get_all_meta").mockReturnValue(meta);
    database.get_rule_text.mockReturnValue("新提示词");
    vi.spyOn(cache.proofreading, "applyChange").mockImplementationOnce(() => {
      expect(cache.readSectionRevisions()).toMatchObject({ items: 2, quality: 3, prompts: 4 });
      expect(cache.prompts.readBlock().translation.text).toBe("新提示词");
      expect(cache.quality.readBlock().glossary.revision).toBe(3);
      throw new Error("view failed");
    });

    database.get_all_items.mockReturnValue([create_item({ id: 2, src: "こんばんは" })]);
    await expect(
      cache.applyCommittedChange({
        ...build_project_committed_change(
          database,
          {
            projectPath: "E:/Project/demo.lg",
            source: "project_write",
            qualityStatisticsScope: "all",
            updatedSections: ["items", "quality", "prompts"],
          },
          meta,
        ),
        sectionRevisions: { items: 2, quality: 3, prompts: 4 },
      }),
    ).rejects.toThrow("view failed");

    expect(cache.snapshot().freshness).toBe("fresh");
    expect(log_manager.warning).toHaveBeenCalled();

    database.get_all_items.mockReturnValue([create_item({ id: 2, src: "こんばんは" })]);

    expect(cache.items.readItem(2)).toEqual(expect.objectContaining({ src: "こんばんは" }));
    expect(cache.snapshot()).toMatchObject({
      freshness: "fresh",
      itemCount: 1,
      sectionRevisions: { items: 2, quality: 3, prompts: 4 },
    });
    expect(cache.prompts.readBlock().translation.text).toBe("新提示词");
  });

  it("提交快照只读取变化条目并更新基础缓存", async () => {
    const items = [
      create_item({ id: 1, src: "こんにちは", dst: "" }),
      create_item({ id: 2, src: "こんばんは", dst: "" }),
    ];
    const database = create_database({
      meta: { "project_runtime_revision.items": 1 },
      items,
    });
    const cache = create_cache({ database });
    database.get_all_items.mockClear();
    database.get_items_by_ids.mockClear();
    database.get_rules.mockClear();
    database.get_rule_text.mockClear();
    items[0] = create_item({ id: 1, src: "こんにちは", dst: "你好" });

    await cache.applyCommittedChange({
      ...build_project_committed_change(
        database,
        {
          projectPath: "E:/Project/demo.lg",
          source: "translation_commit",
          updatedSections: ["items"],
          changedItemIds: [1],
          qualityStatisticsScope: "post_replacement",
        },
        await database.get_all_meta("E:/Project/demo.lg"),
      ),
      sectionRevisions: { items: 2 },
    });

    expect(cache.snapshot()).toMatchObject({
      freshness: "fresh",
      itemCount: 2,
    });
    expect(cache.items.readItem(1)).toEqual(expect.objectContaining({ dst: "你好" }));
    expect(cache.items.readItem(2)).toEqual(expect.objectContaining({ src: "こんばんは" }));
    expect(database.get_items_by_ids).toHaveBeenCalledWith("E:/Project/demo.lg", [1]);
    expect(database.get_all_items).not.toHaveBeenCalled();
    expect(database.get_rules).not.toHaveBeenCalled();
    expect(database.get_rule_text).not.toHaveBeenCalled();
  });
});
