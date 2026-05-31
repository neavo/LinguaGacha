import { describe, expect, it, vi } from "vitest";

import type { AppSettingService } from "../../app/app-setting-service";
import type { BackendWorkerClient } from "../../worker/worker-client";
import {
  createProofreadingListReader,
  evaluateProofreadingSlice,
  type ProofreadingSyncInput,
} from "../../../shared/proofreading/proofreading-list-reader";
import type { CacheReadPort } from "../cache-types";
import type { CacheChange } from "../cache-change";
import { ProofreadingCache } from "./proofreading-cache";

// 提供 ProofreadingCache 所需的最小缓存读口，并允许覆盖 revisions 与 items。
function create_cache_read_port(options: {
  epoch?: number;
  revisions?: Record<string, number>;
  items?: Array<Record<string, unknown>>;
}): CacheReadPort {
  return {
    snapshot: () => ({
      projectPath: "E:/Project/demo.lg",
      epoch: options.epoch ?? 1,
      freshness: "fresh",
      sectionRevisions: options.revisions ?? { files: 1, items: 1, quality: 1, proofreading: 0 },
      itemCount: options.items?.length ?? 1,
    }),
    readSectionRevisions: () =>
      options.revisions ?? { files: 1, items: 1, quality: 1, proofreading: 0 },
    items: {
      readItems: () =>
        options.items ?? [
          {
            id: 1,
            file_path: "script.txt",
            row: 1,
            src: "HP",
            dst: "HP",
            status: "PROCESSED",
            text_type: "NONE",
            retry_count: 0,
          },
        ],
      readItem: (itemId: number) => {
        const items = options.items ?? [
          {
            id: 1,
            file_path: "script.txt",
            row: 1,
            src: "HP",
            dst: "HP",
            status: "PROCESSED",
            text_type: "NONE",
            retry_count: 0,
          },
        ];
        const item = items.find((entry) => Number(entry["item_id"] ?? entry["id"] ?? 0) === itemId);
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
          entries: [{ src: "HP", dst: "生命值" }],
        },
      }),
    },
    prompts: {
      readBlock: () => ({}),
    },
    analysis: {
      readBlock: () => ({}),
    },
  } as CacheReadPort;
}

// 固定测试语言设置，避免缓存测试依赖真实 app setting。
function create_settings(): AppSettingService {
  return {
    read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
  } as unknown as AppSettingService;
}

// 记录 proofreading_sync 输入，并用真实 list reader 评估 worker 返回值。
function create_worker(): BackendWorkerClient & {
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
  } as unknown as BackendWorkerClient & {
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
    analysis: { mode: "keep" },
    ...overrides,
  };
}

describe("ProofreadingCache", () => {
  it("同一工程身份下只执行一次 sync task 并用本地列表 service 查询", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({}),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });

    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(worker.sync_inputs[0]).toMatchObject({
      projectId: "E:/Project/demo.lg",
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      total_item_count: 1,
    });
    expect(view).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      data: { row_count: 1 },
    });
  });

  it("revision 或语言变化会生成新的缓存身份并重新执行 sync task", async () => {
    const worker = create_worker();
    const first_cache = new ProofreadingCache({
      cache: create_cache_read_port({
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await first_cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    const second_cache = new ProofreadingCache({
      cache: create_cache_read_port({
        revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await second_cache.sync({ sourceLanguage: "JA", targetLanguage: "EN" });

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.sync_inputs.map((input) => input.targetLanguage)).toEqual(["ZH", "EN"]);
  });

  it("文件 section revision 变化会生成新的校对缓存身份", async () => {
    const worker = create_worker();
    const first_cache = new ProofreadingCache({
      cache: create_cache_read_port({
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await first_cache.sync({});
    const second_cache = new ProofreadingCache({
      cache: create_cache_read_port({
        revisions: { files: 2, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await second_cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.sync_inputs.map((input) => input.revisions.files)).toEqual([1, 2]);
  });

  it("项目卸载时只清理本地校对缓存并重新执行 sync task", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({}),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await cache.sync({});

    await cache.clearProject("E:/Project/demo.lg");
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("项目切换热机时允许无路径清理旧校对缓存", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({}),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await cache.sync({});

    await cache.clearProject();
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("已同步后 item 增量会应用到本地校对列表运行态", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const items = [
      {
        item_id: 1,
        file_path: "script.txt",
        row_number: 1,
        src: "HP",
        dst: "HP",
        status: "PROCESSED",
        text_type: "NONE",
        retry_count: 0,
      },
    ];
    const service = createProofreadingListReader();
    const apply_delta = vi.spyOn(service, "apply_item_delta");
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions, items }),
      appSettingService: create_settings(),
      workerClient: worker,
      service,
    });
    await cache.sync({});
    revisions.items = 2;
    items[0] = { ...items[0], dst: "生命值" };

    await cache.applyChange(create_delta_change(), revisions);
    const next_sync = await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(apply_delta).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "E:/Project/demo.lg",
        revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
        upsertItems: [expect.objectContaining({ item_id: 1, dst: "生命值" })],
      }),
    );
    expect(next_sync.data.revisions.items).toBe(2);
  });

  it("field-patch 增量会更新旧列表窗口内容且不重建排序", async () => {
    const worker = create_worker();
    const revisions = { files: 1, items: 1, quality: 1, proofreading: 0 };
    const items = [
      {
        item_id: 1,
        file_path: "script.txt",
        row_number: 1,
        src: "A",
        dst: "M",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
      {
        item_id: 2,
        file_path: "script.txt",
        row_number: 2,
        src: "B",
        dst: "Z",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
    ];
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions, items }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
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
      {
        item_id: 1,
        file_path: "script.txt",
        row_number: 1,
        src: "A",
        dst: "A",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
      {
        item_id: 2,
        file_path: "script.txt",
        row_number: 2,
        src: "B",
        dst: "B",
        status: "NONE",
        text_type: "NONE",
        retry_count: 0,
      },
    ];
    const cache = new ProofreadingCache({
      cache: create_cache_read_port({ revisions, items }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
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
      service: createProofreadingListReader(),
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
