import { create_empty_project_prompts } from "../../domain/prompt";
import { create_empty_quality_rule_block } from "../project/project-data-reader";
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

import { ProofreadingCache } from "./proofreading-cache";
import { ItemCache } from "./item-cache";
import { PROOFREADING_WARNING_CODES } from "../../shared/proofreading/proofreading-types";

/** 提供缓存读取器所需的完整条目，各用例覆盖关注字段。 */
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
        ...create_empty_quality_rule_block(),
        glossary: {
          enabled: true,
          mode: "custom",
          revision: 1,
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: false }],
        },
      }),
    },
    prompts: {
      readBlock: create_empty_project_prompts,
    },
  };
}

// 固定测试语言设置，避免缓存测试依赖真实 app setting。
function create_settings(
  settings: Record<string, unknown> = {
    source_language: "JA",
    target_language: "ZH",
    clean_ruby: false,
  },
): AppSettingService {
  return {
    read_setting: () => settings,
  } as unknown as AppSettingService;
}

// 记录 proofreading_sync 输入，并用真实 list reader 评估 worker 返回值。
function create_worker(before_sync?: () => Promise<void>): ComputeWorkerClient & {
  sync_inputs: ProofreadingSyncInput[];
} {
  const sync_inputs: ProofreadingSyncInput[] = [];
  return {
    sync_inputs,
    run: vi.fn(async (task: { type: string; input: ProofreadingSyncInput }) => {
      if (task.type !== "proofreading_sync") {
        throw new Error(`测试未实现 task：${task.type}`);
      }
      await before_sync?.();
      sync_inputs.push(task.input);
      return evaluateProofreadingSlice(task.input);
    }),
    dispose: vi.fn(async () => undefined),
  } as unknown as ComputeWorkerClient & {
    sync_inputs: ProofreadingSyncInput[];
  };
}

// 生成规范行增量，用例只覆盖需要验证的字段。
function create_delta_change(
  overrides: Partial<Parameters<ProofreadingCache["applyChange"]>[0]> = {},
): Parameters<ProofreadingCache["applyChange"]>[0] {
  const updatedSections = overrides.updatedSections ?? ["items"];
  return {
    projectPath: "E:/Project/demo.lg",
    updatedSections,
    sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
    ...(updatedSections.includes("items")
      ? { items: { mode: "delta" as const, records: [create_cache_item()] } }
      : {}),
    ...overrides,
  };
}

describe("ProofreadingCache", () => {
  it("完整条目保留所有字段，隔离嵌套引用且不启动质量评估", () => {
    const extra_field = { nested: { values: [1, false, null, "", '{"nested":true}'] } };
    const item = create_cache_item({
      dst: "",
      name_src: ["角色", "旁白"],
      name_dst: null,
      extra_field,
    });
    const expected_item = structuredClone(item); // 查看结果被修改后，预期仍保留原始缓存事实。
    const worker = create_worker();
    const cache = new ProofreadingCache({
      readPages: () => [],
      cache: create_cache_read_port({ items: [item] }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    const result = cache.rawItem(1);
    expect(result).toEqual({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      data: expected_item,
    });
    (result.data.name_src as string[])[0] = "查看修改";
    (result.data.extra_field as typeof extra_field).nested.values.push("查看修改");
    expect(cache.rawItem(1).data).toEqual(expected_item);
    expect(() => cache.rawItem(2)).toThrow(
      expect.objectContaining({
        diagnostic_context: { reason: "proofreading_item_not_found", item_id: 2 },
      }),
    );
    expect(worker.run).not.toHaveBeenCalled();
  });

  it("完整条目读取后采集恢复后的工程修订", () => {
    const revisions = { items: 1 };
    const items = new ItemCache(() => {
      revisions.items = 9;
    });
    items.replace([create_cache_item()]);
    const cache_port = create_cache_read_port({ revisions });
    const cache = new ProofreadingCache({
      readPages: () => [],
      cache: { ...cache_port, items, snapshot: () => structuredClone(cache_port.snapshot()) },
      appSettingService: create_settings(),
      workerClient: create_worker(),
      reader: createProofreadingReader(),
    });
    expect(cache.rawItem(1).sectionRevisions).toEqual({ items: 9 });
  });

  it("同一工程身份下只执行一次 sync task 并用本地 reader 查询", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      readPages: () => [],
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
      readPages: () => [],
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

  it.each<{
    file_type: "TRANS" | "EPUB";
    extra_field: ProjectItemPublicRecord["extra_field"];
    internal_file_path: string;
  }>([
    {
      file_type: "TRANS",
      extra_field: { trans_ref: { file_key: "data/Actors.json", row_index: 0 } },
      internal_file_path: "data/Actors.json",
    },
    {
      file_type: "EPUB",
      extra_field: { epub: { doc_path: "OEBPS/Text/ch01.xhtml" } },
      internal_file_path: "OEBPS/Text/ch01.xhtml",
    },
  ])(
    "$file_type 的列表、详情和候选共用运行态内部路径",
    async ({ file_type, extra_field, internal_file_path }) => {
      const worker = create_worker();
      const items = [
        create_cache_item({
          file_path: "game.trans",
          file_type,
          src: "A",
          dst: "甲",
          extra_field,
        }),
      ];
      const cache_port = create_cache_read_port({ items });
      cache_port.files.readFileEntries = () => [
        { rel_path: "game.trans", file_type, sort_index: 0 },
      ];
      const cache = new ProofreadingCache({
        readPages: () => [],
        cache: cache_port,
        appSettingService: create_settings(),
        workerClient: worker,
        reader: createProofreadingReader(),
      });

      const rows = await cache.itemsByRowIds({ row_ids: ["1"] });

      const sync = await cache.sync({});
      const view = await cache.list({
        filters: sync.data.defaultFilters,
        keyword: "",
        scope: "all",
        is_regex: false,
        sort_state: null,
      });
      expect(sync.data.files).toEqual([
        { file_path: "game.trans", internal_file_path, kind: "item", count: 1 },
      ]);
      expect(view.data.window_rows[0]).toMatchObject({ item: { internal_file_path } });
      expect(rows.data[0]).toMatchObject({
        item_id: 1,
        internal_file_path,
      });
    },
  );

  it("文件修订复用文本评估，语言变化重新评估", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const cache = new ProofreadingCache({
      readPages: () => [],
      cache: create_cache_read_port({ revisions }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    await cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    revisions.files = 2;
    await cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    await cache.sync({ sourceLanguage: "JA", targetLanguage: "EN" });

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(
      worker.sync_inputs.map((input) => [
        input.revisions.files,
        input.processingConfig.target_language,
      ]),
    ).toEqual([
      [1, "ZH"],
      [2, "EN"],
    ]);
  });

  it("完整文本处理配置变化会生成新的缓存身份", async () => {
    const worker = create_worker();
    const settings = {
      source_language: "JA",
      target_language: "ZH",
      clean_ruby: false,
    };
    const cache = new ProofreadingCache({
      readPages: () => [],
      cache: create_cache_read_port({}),
      appSettingService: create_settings(settings),
      workerClient: worker,
      reader: createProofreadingReader(),
    });

    await cache.sync({});
    settings.clean_ruby = true;
    await cache.sync({});

    expect(worker.sync_inputs.map((input) => input.processingConfig)).toEqual([
      {
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: false,
      },
      {
        source_language: "JA",
        target_language: "ZH",
        clean_ruby: true,
      },
    ]);
  });

  it("只清理匹配工程或当前校对缓存", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      readPages: () => [],
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
      readPages: () => [],
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
    items[0] = { ...items[0]!, dst: "生命值" };

    await cache.applyChange({
      ...create_delta_change({ items: { mode: "delta", records: items } }),
      sectionRevisions: revisions,
    });
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

  it("规范行增量更新旧列表窗口内容并保留排序", async () => {
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
      readPages: () => [],
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
    items[1] = { ...items[1]!, dst: "A", status: "PROCESSED" };

    await cache.applyChange({
      ...create_delta_change({
        items: {
          mode: "delta",
          records: [items[1]!],
        },
      }),
      sectionRevisions: revisions,
    });
    const window = await cache.window({
      view_id: view.data.view_id,
      start: 0,
      count: 10,
    });

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(window.data.rows.map((row) => row.row_id)).toEqual(["1", "2"]);
    expect(window.data.rows.filter((row) => row.kind === "item")[1]?.item).toMatchObject({
      item_id: 2,
      dst: "A",
      status: "PROCESSED",
    });
  });

  it("quality 变化会失效已同步的文本评估", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const cache = new ProofreadingCache({
      readPages: () => [],
      cache: create_cache_read_port({ revisions }),
      appSettingService: create_settings(),
      workerClient: worker,
      reader: createProofreadingReader(),
    });
    await cache.sync({});
    revisions.quality = 2;

    await cache.applyChange({
      ...create_delta_change({
        updatedSections: ["quality"],
      }),
      sectionRevisions: revisions,
    });
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
  });
});

it("页面修订号单独触发补读，滚动和文本增量复用页面与评估", async () => {
  const revisions = { files: 1, items: 1, quality: 1, proofreading: 0, pdf: 1 };
  const cache = create_cache_read_port({ revisions, items: [] });
  cache.files.readFileEntries = () => [
    { rel_path: "book.pdf", file_type: "PDF", sort_index: 0 },
    { rel_path: "script.txt", file_type: "TXT", sort_index: 1 },
  ];
  const readPages = vi.fn(() => [
    {
      file_path: "book.pdf",
      document: {
        digest: "test",
        pages: [
          {
            page: 1,
            width: 300,
            height: 300,
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
  const service = new ProofreadingCache({
    cache,
    readPages,
    appSettingService: create_settings(),
    workerClient: worker,
    reader: createProofreadingReader(),
  });
  const initial = await service.sync({});
  const view = await service.list({
    filters: initial.data.defaultFilters,
    keyword: "",
    scope: "all",
    is_regex: false,
    sort_state: null,
  });
  expect(view.data.window_rows).toMatchObject([{ kind: "page" }]);
  expect(view.data.row_count).toBe(1);
  revisions.pdf++;
  const updated = await service.sync({});
  await service.window({ view_id: view.data.view_id, start: 0, count: 10 });
  expect(updated.data.revisions.pdf).toBe(2);
  expect(worker.run).toHaveBeenCalledTimes(1);
  expect(readPages).toHaveBeenCalledTimes(2);
  revisions.items++;
  await service.applyChange({ ...create_delta_change(), sectionRevisions: revisions });
  await service.sync({});
  expect(readPages).toHaveBeenCalledTimes(2);
  expect(worker.run).toHaveBeenCalledTimes(1);
  revisions.quality++;
  await service.applyChange({
    ...create_delta_change({ updatedSections: ["quality"] }),
    sectionRevisions: revisions,
  });
  await service.sync({});
  expect(readPages).toHaveBeenCalledTimes(2);
  expect(worker.run).toHaveBeenCalledTimes(2);
  expect(
    (
      await service.list({
        filters: initial.data.defaultFilters,
        keyword: "",
        scope: "all",
        is_regex: false,
        sort_state: null,
      })
    ).data.window_rows,
  ).toMatchObject([{ kind: "page" }]);
});

it("撤销同步后，迟到计算结果不能恢复旧工程索引", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const cache = create_cache_read_port({});
  const worker = create_worker(() => pending);
  const reader = createProofreadingReader();
  const readPages = vi.fn(() => []);
  const service = new ProofreadingCache({
    cache,
    readPages,
    appSettingService: create_settings(),
    workerClient: worker,
    reader,
  });
  const sync = service.sync({});
  const rejected = expect(sync).rejects.toThrow();
  await service.clearProject();
  release();
  await rejected;
  expect(readPages).not.toHaveBeenCalled();
  expect(reader.read_items_by_row_ids({ row_ids: ["1"] })).toEqual([]);
});

it.each(["files", "items"] as const)(
  "评估进行中发生 %s 变化，按文本依赖决定是否接受结果",
  async (section) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const cache = create_cache_read_port({
      revisions,
      items: [
        create_cache_item({ item_id: 1, file_path: "a.txt" }),
        create_cache_item({ item_id: 2, file_path: "b.txt" }),
      ],
    });
    const files = vi.fn(() => [
      { rel_path: "a.txt", file_type: "TXT", sort_index: 0 },
      { rel_path: "b.txt", file_type: "TXT", sort_index: 1 },
    ]);
    cache.files.readFileEntries = files;
    const worker = create_worker(() => pending);
    const reader = createProofreadingReader();
    const service = new ProofreadingCache({
      cache,
      workerClient: worker,
      reader,
      readPages: () => [],
      appSettingService: create_settings(),
    });
    const sync = service.sync({});
    const rejected = section === "items" ? expect(sync).rejects.toThrow() : null;
    revisions[section]++;
    files.mockReturnValue([
      { rel_path: "b.txt", file_type: "TXT", sort_index: 0 },
      { rel_path: "a.txt", file_type: "TXT", sort_index: 1 },
    ]);
    await service.applyChange({
      ...(section === "items"
        ? create_delta_change()
        : create_delta_change({
            updatedSections: ["files"],
          })),
      sectionRevisions: revisions,
    });
    release();
    if (rejected !== null) {
      await rejected;
      expect(reader.read_items_by_row_ids({ row_ids: ["1", "2"] })).toEqual([]);
    } else {
      const result = await sync;
      expect(result.sectionRevisions.files).toBe(2);
      expect(result.data.files.map((file) => file.file_path)).toEqual(["b.txt", "a.txt"]);
      const view = await service.list({
        filters: result.data.defaultFilters,
        keyword: "",
        scope: "all",
        is_regex: false,
        sort_state: null,
      });
      expect(view.data.window_rows.map((row) => row.row_id)).toEqual(["2", "1"]);
    }
    expect(worker.run).toHaveBeenCalledTimes(1);
  },
);

it("热同步响应的修订号绑定返回快照，不借用等待期间发生的新文件修订", async () => {
  const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
  const service = new ProofreadingCache({
    cache: create_cache_read_port({ revisions }),
    reader: createProofreadingReader(),
    workerClient: create_worker(),
    readPages: () => [],
    appSettingService: create_settings(),
  });
  await service.sync({});
  const pending = service.sync({});
  revisions.files = 2;
  await service.applyChange({
    ...create_delta_change({ updatedSections: ["files"] }),
    sectionRevisions: revisions,
  });
  const old = await pending;
  expect(old.data.revisions.files).toBe(1);
  expect(old.sectionRevisions.files).toBe(1);
  const current = await service.sync({});
  expect(current.data.revisions.files).toBe(2);
  expect(current.sectionRevisions.files).toBe(2);
});
