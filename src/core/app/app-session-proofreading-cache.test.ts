import { describe, expect, it, vi } from "vitest";

import type { AppSessionCache } from "./app-session-cache";
import { AppSessionProofreadingCache } from "./app-session-proofreading-cache";
import type { AppSettingService } from "./app-setting-service";
import type { ProofreadingQueryWorker } from "../project/proofreading/proofreading-query-worker";
import type {
  ProofreadingQueryWorkerQueryInput,
  ProofreadingQueryWorkerQueryResult,
  ProofreadingQueryWorkerSyncInput,
} from "../project/proofreading/proofreading-query-worker-protocol";

function create_app_session_cache(options: {
  epoch?: number;
  revisions?: Record<string, number>;
  items?: Array<Record<string, unknown>>;
}): AppSessionCache {
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
    readFileEntries: () => [{ rel_path: "script.txt", file_type: "TXT", sort_index: 0 }],
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
    readQualityBlock: () => ({
      glossary: {
        enabled: true,
        mode: "custom",
        revision: 1,
        entries: [{ src: "HP", dst: "生命值" }],
      },
    }),
  } as unknown as AppSessionCache;
}

function create_settings(): AppSettingService {
  return {
    read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
  } as unknown as AppSettingService;
}

function create_worker(): ProofreadingQueryWorker & {
  synced_keys: string[];
  sync_inputs: ProofreadingQueryWorkerSyncInput[];
} {
  const synced_keys: string[] = [];
  const sync_inputs: ProofreadingQueryWorkerSyncInput[] = [];
  const syncProofreadingCache = vi.fn(
    async (key: string, input: ProofreadingQueryWorkerSyncInput) => {
      synced_keys.push(key);
      sync_inputs.push(input);
      return {
        syncState: {
          projectId: input.projectId,
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          revisions: input.revisions,
          defaultFilters: {
            warning_types: [],
            statuses: [],
            file_paths: [],
            glossary_terms: [],
            include_without_glossary_miss: true,
          },
        },
      };
    },
  );
  const queryProofreadingCache = vi.fn(
    async (
      _key: string,
      input: ProofreadingQueryWorkerQueryInput,
    ): Promise<ProofreadingQueryWorkerQueryResult> => {
      if (input.action === "list") {
        return {
          action: "list",
          data: {
            projectId: "E:/Project/demo.lg",
            revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
            view_id: "view-1",
            row_count: 1,
            window_start: 0,
            window_rows: [],
            invalid_regex_message: null,
          },
        };
      }
      throw new Error(`测试未实现 query：${input.action}`);
    },
  );
  return {
    synced_keys,
    sync_inputs,
    syncProofreadingCache,
    queryProofreadingCache,
    disposeProofreadingCache: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as ProofreadingQueryWorker & {
    synced_keys: string[];
    sync_inputs: ProofreadingQueryWorkerSyncInput[];
  };
}

describe("AppSessionProofreadingCache", () => {
  it("同一工程身份下复用 worker 内校对模型并只返回轻量查询结果", async () => {
    const worker = create_worker();
    const cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({}),
      appSettingService: create_settings(),
      worker,
    });

    const sync = await cache.sync({});
    const view = await cache.list({
      filters: sync.data.defaultFilters,
      keyword: "",
      scope: "all",
      is_regex: false,
      sort_state: null,
    });

    expect(worker.syncProofreadingCache).toHaveBeenCalledTimes(1);
    expect(worker.sync_inputs[0]).toMatchObject({
      projectId: "E:/Project/demo.lg",
      sourceLanguage: "JA",
      targetLanguage: "ZH",
      total_item_count: 1,
    });
    expect(view).toMatchObject({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      data: { view_id: "view-1" },
    });
  });

  it("revision 或语言变化会生成新的缓存身份并重新同步 worker", async () => {
    const worker = create_worker();
    const first_cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      worker,
    });
    await first_cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    const second_cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({
        revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      worker,
    });
    await second_cache.sync({ sourceLanguage: "JA", targetLanguage: "EN" });

    expect(worker.syncProofreadingCache).toHaveBeenCalledTimes(2);
    expect(new Set(worker.synced_keys).size).toBe(2);
    expect(worker.sync_inputs.map((input) => input.targetLanguage)).toEqual(["ZH", "EN"]);
  });

  it("文件 section revision 变化会生成新的校对缓存身份", async () => {
    const worker = create_worker();
    const first_cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      worker,
    });
    await first_cache.sync({});
    const second_cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({
        revisions: { files: 2, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      worker,
    });
    await second_cache.sync({});

    expect(worker.syncProofreadingCache).toHaveBeenCalledTimes(2);
    expect(new Set(worker.synced_keys).size).toBe(2);
    expect(worker.sync_inputs.map((input) => input.revisions.files)).toEqual([1, 2]);
  });

  it("项目卸载时清理当前校对缓存并通知 worker", async () => {
    const worker = create_worker();
    const cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({}),
      appSettingService: create_settings(),
      worker,
    });
    await cache.sync({});

    await cache.disposeProject("E:/Project/demo.lg");
    await cache.sync({});

    expect(worker.disposeProofreadingCache).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: "E:/Project/demo.lg" }),
    );
    expect(worker.syncProofreadingCache).toHaveBeenCalledTimes(2);
  });

  it("项目切换热机时允许无路径清理旧校对缓存", async () => {
    const worker = create_worker();
    const cache = new AppSessionProofreadingCache({
      appSessionCache: create_app_session_cache({}),
      appSettingService: create_settings(),
      worker,
    });
    await cache.sync({});

    await cache.disposeProject();
    await cache.sync({});

    expect(worker.disposeProofreadingCache).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.any(String) }),
    );
    expect(worker.syncProofreadingCache).toHaveBeenCalledTimes(2);
  });
});
