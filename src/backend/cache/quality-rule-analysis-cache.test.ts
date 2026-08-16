import { describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import type { CacheChange } from "./cache-change";
import { QualityRuleAnalysisCache } from "./quality-rule-analysis-cache";

type AnalysisCacheOptions = ConstructorParameters<typeof QualityRuleAnalysisCache>[0];
type AnalysisCacheReadPort = AnalysisCacheOptions["cache"] & {
  items_value: ProjectItemPublicRecord[];
};
type AnalysisWorker = AnalysisCacheOptions["workerClient"];
type AnalysisWorkerTask = Parameters<AnalysisWorker["run"]>[0];

function create_cache_read_port(): AnalysisCacheReadPort {
  const port: AnalysisCacheReadPort = {
    items_value: [create_item()],
    snapshot: vi.fn(() => ({
      projectPath: "E:/Project/demo.lg",
      epoch: 1,
      freshness: "fresh" as const,
      sectionRevisions: { items: 1, quality: 1 },
      itemCount: port.items_value.length,
    })),
    readSectionRevisions: vi.fn(() => ({ items: 1, quality: 1 })),
    items: {
      readItems: vi.fn(() => port.items_value.map((item) => ({ ...item }))),
      readItem: (_item_id: number) => null,
    },
    quality: {
      readBlock: vi.fn(() => ({
        glossary: { entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }] },
        post_replacement: {
          entries: [{ entry_id: "hp-post", src: "生命值", dst: "体力", regex: false }],
        },
      })),
    },
  };
  return port;
}

function create_item(): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "HP",
    dst: "生命值",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "NONE",
    status: "PROCESSED",
    retry_count: 0,
    skip_internal_filter: false,
  };
}

function create_worker(): AnalysisWorker & {
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (task: AnalysisWorkerTask) => {
    if (task.type !== "quality_rule_analysis") throw new Error("unexpected task");
    return {
      entry_ids: task.input.entry_ids,
      hits_by_entry_id: Object.fromEntries(task.input.entry_ids.map((id: string) => [id, 1])),
      examples_by_entry_id: Object.fromEntries(
        task.input.entry_ids.map((id: string) => [id, ["example"]]),
      ),
      ...(task.input.include_subset_parents
        ? {
            subset_parents_by_entry_id: {},
          }
        : {}),
    };
  });
  return { run };
}

function create_cache_change(overrides: Partial<CacheChange> = {}): CacheChange {
  return {
    eventType: "project.items.changed",
    projectPath: "E:/Project/demo.lg",
    source: "translation_batch_update",
    affectedSections: ["items"],
    sectionRevisions: { items: 2 },
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

describe("QualityRuleAnalysisCache", () => {
  it("重复和并发读取复用同一个 worker 结果", async () => {
    const port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityRuleAnalysisCache({ cache: port, workerClient: worker });

    await Promise.all([cache.read("glossary"), cache.read("glossary")]);
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(1);
    expect(worker.run.mock.calls[0]?.[0]).toMatchObject({
      type: "quality_rule_analysis",
      input: { include_subset_parents: true },
    });
  });

  it("缓存命中不读取质量规则或 item，不计算内容签名", async () => {
    const port = create_cache_read_port();
    const cache = new QualityRuleAnalysisCache({ cache: port, workerClient: create_worker() });
    await cache.read("glossary");
    vi.mocked(port.quality.readBlock).mockClear();
    vi.mocked(port.items.readItems).mockClear();

    await cache.read("glossary");

    expect(port.quality.readBlock).not.toHaveBeenCalled();
    expect(port.items.readItems).not.toHaveBeenCalled();
  });

  it("worker 失败后允许重新计算", async () => {
    const worker = create_worker();
    worker.run.mockRejectedValueOnce(new Error("worker failed"));
    const cache = new QualityRuleAnalysisCache({
      cache: create_cache_read_port(),
      workerClient: worker,
    });

    await expect(cache.read("glossary")).rejects.toThrow("worker failed");
    await expect(cache.read("glossary")).resolves.toMatchObject({
      analysis: { entry_ids: ["hp"] },
    });
    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("只改译文仅失效后置替换统计，并复用已有父项", async () => {
    const worker = create_worker();
    const cache = new QualityRuleAnalysisCache({
      cache: create_cache_read_port(),
      workerClient: worker,
    });
    await cache.read("glossary");
    await cache.read("post_replacement");

    cache.applyChange(create_cache_change());
    await cache.read("glossary");
    await cache.read("post_replacement");

    expect(worker.run).toHaveBeenCalledTimes(3);
    expect(worker.run.mock.calls[2]?.[0]).toMatchObject({
      input: { include_subset_parents: false },
    });
  });

  it("质量规则全量变化同时失效统计和父项", async () => {
    const worker = create_worker();
    const cache = new QualityRuleAnalysisCache({
      cache: create_cache_read_port(),
      workerClient: worker,
    });
    await cache.read("glossary");
    cache.applyChange(
      create_cache_change({
        eventType: "project.quality.changed",
        affectedSections: ["quality"],
        items: { mode: "keep" },
        quality: { mode: "full" },
      }),
    );
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(2);
    expect(worker.run.mock.calls[1]?.[0]).toMatchObject({
      input: { include_subset_parents: true },
    });
  });
});
