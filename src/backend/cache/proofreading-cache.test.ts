import { describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import type { AppSettingService } from "../app/app-setting-service";
import type { ComputeWorkerClient } from "../worker/compute-worker-client";
import {
  createProofreadingReader,
  evaluateProofreadingSlice,
  type ProofreadingSyncInput,
} from "../../shared/proofreading/proofreading-reader";
import type { CacheReadPort } from "./cache-types";
import type { CacheChange } from "./cache-change";
import { ProofreadingCache } from "./proofreading-cache";
import { PROOFREADING_WARNING_CODES } from "../../shared/proofreading/proofreading-types";

function create_cache_item(
  overrides: Partial<ProjectItemPublicRecord> = {},
): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "HP",
    dst: "HP",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 1,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "NONE",
    status: "PROCESSED",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

// 提供 ProofreadingCache 所需的最小缓存读口，并允许覆盖 revisions 与 items。
function create_cache_read_port(options: {
  epoch?: number;
  revisions?: Record<string, number>;
  items?: ProjectItemPublicRecord[];
}): CacheReadPort {
  const revisions = options.revisions ?? { files: 1, items: 1, quality: 1, proofreading: 0 };
  const items = options.items ?? [create_cache_item()];
  return {
    snapshot: () => ({
      projectPath: "E:/Project/demo.lg",
      epoch: options.epoch ?? 1,
      freshness: "fresh",
      sectionRevisions: revisions,
      itemCount: items.length,
    }),
    readSectionRevisions: () => revisions,
    items: {
      readItems: () => items,
      readItem: (itemId: number) => {
        const item = items.find((entry) => entry.item_id === itemId);
        return item === undefined ? null : { ...item };
      },
    },
    files: {
      readFileEntries: () => [{ rel_path: "script.txt", file_type: "TXT", sort_index: 0 }],
    },
    quality: {
      readBlock: () => ({
        glossary: {
          enabled: true,
          mode: "custom",
          revision: 1,
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
        },
      }),
    },
    prompts: {
      readBlock: () => ({}),
    },
  };
}

// 固定测试语言设置，避免缓存测试依赖真实 app setting。
function create_settings(
  settings: Record<string, unknown> = {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
    auto_process_prefix_suffix_preserved_text: true,
  },
): AppSettingService {
  return {
    read_setting: () => settings,
  } as unknown as AppSettingService;
}

// 记录 proofreading_sync 输入，并用真实 list reader 评估 worker 返回值。
function create_worker(): ComputeWorkerClient & {
  sync_inputs: ProofreadingSyncInput[];
} {
  const sync_inputs: ProofreadingSyncInput[] = [];
  return {
    sync_inputs,
    run: vi.fn(async (task: { type: string; input: ProofreadingSyncInput }) => {
      if (task.type !== "proofreading_sync") {
        throw new Error(`测试未实现 task：${task.type}`);
      }
      sync_inputs.push(task.input);
      return evaluateProofreadingSlice(task.input);
    }),
    dispose: vi.fn(async () => undefined),
  } as unknown as ComputeWorkerClient & {
    sync_inputs: ProofreadingSyncInput[];
  };
}

// 生成 items delta 事件，用例只覆盖需要验证的字段。
function create_delta_change(overrides: Partial<CacheChange> = {}): CacheChange {
  return {
    eventType: "project.items.changed",
    projectPath: "E:/Project/demo.lg",
    source: "translation_commit",
    affectedSections: ["items"],
    sectionRevisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
    fullRebuild: false,
    items: {
      mode: "delta",
      changedIds: [1],
      deleteIds: [],
      fieldPatch: null,
      sourcePayloadMode: "canonical-delta",
    },
    files: { mode: "keep" },
    quality: { mode: "keep" },
    prompts: { mode: "keep" },
    settings: { mode: "keep" },

    ...overrides,
  };
}

describe("ProofreadingCache", () => {
  it("同一工程身份下只执行一次 sync task 并用本地 reader 查询", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({}),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    const context = await cache.context({ row_id: "1" });
    const warnings = await cache.warnings({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keywords: [],
      scope: "all",
      offset: 0,
      limit: 20,
    });

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(worker.sync_inputs[0]).toMatchObject({
      projectId: "E:/Project/demo.lg",
      processingConfig: {
        source_language: "JA",
        target_language: "ZH",
      },
      total_item_count: 1,
    });
    expect(view).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      data: { row_count: 1 },
    });
    expect(context).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      data: [{ row_id: "1" }],
    });
    expect(warnings).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      data: { total_item_count: 1, items: [{ item_id: 1 }] },
    });
  });

  it("已同步身份的列表和窗口查询不会重复读取全量 items", async () => {
    const worker = create_worker();
    const cache_port = create_cache_read_port({});
    const read_items = vi.spyOn(cache_port.items, "readItems");
    const cache = new ProofreadingCache({
      cache: cache_port,
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    await cache.rowIndex({ view_id: view.data.view_id, row_id: "1" });
    await cache.window({ view_id: view.data.view_id, start: 0, count: 10 });

    expect(read_items).toHaveBeenCalledTimes(1);
  });

  it("按 row id 查询时只从热缓存补 TRANS 内部路径", async () => {
    const worker = create_worker();
    const items = [
      create_cache_item({
        file_path: "game.trans",
        file_type: "TRANS",
        src: "A",
        dst: "甲",
        extra_field: { trans_ref: { file_key: "data/Actors.json", row_index: 0 } },
      }),
    ];
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ items }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    const rows = await cache.itemsByRowIds({ row_ids: ["1"] });

    expect(worker.sync_inputs[0]?.upsertItems[0]).not.toHaveProperty("internal_file_path");
    expect(rows.data[0]).toMatchObject({
      item_id: 1,
      internal_file_path: "data/Actors.json",
    });
  });

  it("revision 或语言变化会生成新的缓存身份并重新执行 sync task", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    await cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    revisions.files = 2;
    await cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    await cache.sync({ sourceLanguage: "JA", targetLanguage: "EN" });

    expect(worker.run).toHaveBeenCalledTimes(3);
    expect(
      worker.sync_inputs.map((input) => [
        input.revisions.files,
        input.processingConfig.target_language,
      ]),
    ).toEqual([
      [1, "ZH"],
      [2, "ZH"],
      [2, "EN"],
    ]);
  });

  it("完整文本处理配置变化会生成新的缓存身份", async () => {
    const worker = create_worker();
    const settings = {
      source_language: "JA",
      target_language: "ZH",
      clean_ruby: false,
      auto_process_prefix_suffix_preserved_text: true,
    };
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({}),
      appSettingService: create_settings(settings),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    await cache.sync({});
    settings.clean_ruby = true;
    await cache.sync({});
    settings.auto_process_prefix_suffix_preserved_text = false;
    await cache.sync({});

    expect(worker.sync_inputs.map((input) => input.processingConfig)).toEqual([
      {
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: false,
        auto_process_prefix_suffix_preserved_text: true,
      },
      {
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: true,
        auto_process_prefix_suffix_preserved_text: true,
      },
      {
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: true,
        auto_process_prefix_suffix_preserved_text: false,
      },
    ]);
  });

  it("只清理匹配工程或当前校对缓存", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({}),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    await cache.sync({});

    await cache.clearProject("E:/Project/other.lg");
    await cache.sync({});
    await cache.clearProject("E:/Project/demo.lg");
    await cache.sync({});
    await cache.clearProject();
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(3);
  });

  it("已同步后 item 增量会应用到本地校对列表运行态", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const items = [
      create_cache_item({
        src: "HP",
        dst: "HP",
      }),
    ];
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions, items }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });
    revisions.items = 2;
    items[0] = { ...items[0], dst: "生命值" };

    await cache.applyChange(create_delta_change(), revisions);
    const next_sync = await cache.sync({});
    const rows = await cache.itemsByRowIds({ row_ids: ["1"] });
    const warnings = await cache.warnings({
      warning_types: [...PROOFREADING_WARNING_CODES],
      keywords: [],
      scope: "all",
      offset: 0,
      limit: 20,
    });
    const old_window = await cache.window({ view_id: view.data.view_id, start: 0, count: 10 });

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(next_sync.data.revisions.items).toBe(2);
    expect(rows.data).toMatchObject([{ item_id: 1, dst: "生命值" }]);
    expect(warnings.data).toMatchObject({ total_item_count: 0, items: [] });
    expect(old_window.data.rows).toMatchObject([{ item: { item_id: 1, dst: "生命值" } }]);
  });

  it("field-patch 增量会更新旧列表窗口内容且不重建排序", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const items = [
      create_cache_item({
        item_id: 1,
        row_number: 1,
        src: "A",
        dst: "M",
        status: "NONE",
      }),
      create_cache_item({
        item_id: 2,
        row_number: 2,
        src: "B",
        dst: "Z",
        status: "NONE",
      }),
    ];
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions, items }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: { column_id: "dst", direction: "ascending" },
      window_start: 0,
      window_count: 10,
    });
    revisions.items = 2;

    await cache.applyChange(
      create_delta_change({
        items: {
          mode: "delta",
          changedIds: [2],
          deleteIds: [],
          fieldPatch: { dst: "A", status: "PROCESSED" },
          sourcePayloadMode: "field-patch",
        },
      }),
      revisions,
    );
    const window = await cache.window({
      view_id: view.data.view_id,
      start: 0,
      count: 10,
    });

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(window.data.rows.map((row) => row.row_id)).toEqual(["1", "2"]);
    expect(window.data.rows[1]?.item).toMatchObject({
      item_id: 2,
      dst: "A",
      status: "PROCESSED",
    });
  });

  it("删除增量会剪裁旧列表窗口", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const items = [
      create_cache_item({
        item_id: 1,
        row_number: 1,
        src: "A",
        dst: "A",
        status: "NONE",
      }),
      create_cache_item({
        item_id: 2,
        row_number: 2,
        src: "B",
        dst: "B",
        status: "NONE",
      }),
    ];
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions, items }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
      window_start: 0,
      window_count: 10,
    });
    revisions.items = 2;
    items.splice(0, 1);

    await cache.applyChange(
      create_delta_change({
        items: {
          mode: "delta",
          changedIds: [],
          deleteIds: [1],
          fieldPatch: null,
          sourcePayloadMode: "canonical-delta",
        },
      }),
      revisions,
    );
    const window = await cache.window({
      view_id: view.data.view_id,
      start: 0,
      count: 10,
    });

    expect(window.data.row_count).toBe(1);
    expect(window.data.rows.map((row) => row.row_id)).toEqual(["2"]);
  });

  it("quality 或 files 变化会失效已同步的校对缓存", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    await cache.sync({});
    revisions.quality = 2;

    await cache.applyChange(
      create_delta_change({
        eventType: "project.quality.changed",
        affectedSections: ["quality"],
        sectionRevisions: { quality: 2 },
        items: { mode: "keep" },
        quality: { mode: "full" },
      }),
      revisions,
    );
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
  });
});
