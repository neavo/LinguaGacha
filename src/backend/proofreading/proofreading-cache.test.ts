import { describe, expect, it, vi } from "vitest";

import type { ProjectDataCache } from "../project/project-data";
import { ProofreadingCache } from "../proofreading/proofreading-cache";
import type { AppSettingService } from "../app/app-setting-service";
import type { BackendWorkerClient } from "../worker/worker-client";
import {
  createProofreadingListReader,
  evaluateProofreadingSlice,
  type ProofreadingHydrationInput,
} from "../../shared/proofreading/proofreading-list-reader";

function create_project_data_cache(options: {
  epoch?: number;
  revisions?: Record<string, number>;
  items?: Array<Record<string, unknown>>;
}): ProjectDataCache {
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
  } as unknown as ProjectDataCache;
}

function create_settings(): AppSettingService {
  return {
    read_setting: () => ({ source_language: "JA", target_language: "ZH" }),
  } as unknown as AppSettingService;
}

function create_worker(): BackendWorkerClient & {
  hydration_inputs: ProofreadingHydrationInput[];
} {
  const hydration_inputs: ProofreadingHydrationInput[] = [];
  return {
    hydration_inputs,
    run: vi.fn(async (task: { type: string; input: ProofreadingHydrationInput }) => {
      if (task.type !== "proofreading_hydration") {
        throw new Error(`测试未实现 task：${task.type}`);
      }
      hydration_inputs.push(task.input);
      return evaluateProofreadingSlice(task.input);
    }),
    dispose: vi.fn(async () => undefined),
  } as unknown as BackendWorkerClient & {
    hydration_inputs: ProofreadingHydrationInput[];
  };
}

describe("ProofreadingCache", () => {
  it("同一工程身份下只执行一次 hydration task 并用本地列表 service 查询", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({}),
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
    expect(worker.hydration_inputs[0]).toMatchObject({
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

  it("revision 或语言变化会生成新的缓存身份并重新执行 hydration task", async () => {
    const worker = create_worker();
    const first_cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await first_cache.sync({ sourceLanguage: "JA", targetLanguage: "ZH" });
    const second_cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({
        revisions: { files: 1, items: 2, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await second_cache.sync({ sourceLanguage: "JA", targetLanguage: "EN" });

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.hydration_inputs.map((input) => input.targetLanguage)).toEqual(["ZH", "EN"]);
  });

  it("文件 section revision 变化会生成新的校对缓存身份", async () => {
    const worker = create_worker();
    const first_cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({
        revisions: { files: 1, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await first_cache.sync({});
    const second_cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({
        revisions: { files: 2, items: 1, quality: 1, proofreading: 0 },
      }),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await second_cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.hydration_inputs.map((input) => input.revisions.files)).toEqual([1, 2]);
  });

  it("项目卸载时只清理本地校对缓存并重新执行 hydration task", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({}),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await cache.sync({});

    await cache.disposeProject("E:/Project/demo.lg");
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("项目切换热机时允许无路径清理旧校对缓存", async () => {
    const worker = create_worker();
    const cache = new ProofreadingCache({
      projectDataCache: create_project_data_cache({}),
      appSettingService: create_settings(),
      workerClient: worker,
      service: createProofreadingListReader(),
    });
    await cache.sync({});

    await cache.disposeProject();
    await cache.sync({});

    expect(worker.run).toHaveBeenCalledTimes(2);
  });
});
