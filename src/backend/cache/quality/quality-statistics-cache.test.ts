import { describe, expect, it, vi } from "vitest";

import type { BackendWorkerClient } from "../../worker/worker-client";
import type { BackendWorkerTask } from "../../worker/worker-task";
import type { CacheChange } from "../cache-change";
import type { CacheReadPort } from "../cache-types";
import { QualityStatisticsCache } from "./quality-statistics-cache";

/**
 * 构造可变的 cache read port，让测试通过公开 read/applyChange 观察缓存失效行为。
 */
function create_cache_read_port(): CacheReadPort & {
  revisions: Record<string, number>;
  items_value: Array<Record<string, unknown>>;
} {
  const port = {
    revisions: { items: 1, quality: 1 },
    items_value: [{ item_id: 1, src: "HP", dst: "生命值", status: "PROCESSED" }],
    snapshot() {
      return {
        projectPath: "E:/Project/demo.lg",
        epoch: 1,
        freshness: "fresh",
        sectionRevisions: this.revisions,
        itemCount: this.items_value.length,
      };
    },
    readSectionRevisions() {
      return this.revisions;
    },
    items: {
      readItems: () => port.items_value.map((item) => ({ ...item })),
      readItem: () => null,
    },
    files: {
      readFileEntries: () => [],
    },
    quality: {
      readBlock: () => ({
        glossary: {
          entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
          enabled: true,
          mode: "custom",
          revision: 1,
        },
        pre_replacement: {
          entries: [{ entry_id: "hp-pre", src: "HP", dst: "生命值" }],
          enabled: true,
          mode: "custom",
          revision: 1,
        },
        post_replacement: {
          entries: [{ entry_id: "hp-post", src: "生命值", dst: "体力" }],
          enabled: true,
          mode: "custom",
          revision: 1,
        },
        text_preserve: {
          entries: [{ entry_id: "hp-preserve", src: "HP" }],
          enabled: true,
          mode: "custom",
          revision: 1,
        },
      }),
    },
    prompts: {
      readBlock: () => ({}),
    },
    analysis: {
      readBlock: () => ({}),
    },
  } as CacheReadPort & {
    revisions: Record<string, number>;
    items_value: Array<Record<string, unknown>>;
  };
  return port;
}

/**
 * worker mock 返回输入身份快照，便于断言缓存是否复用同一次计算。
 */
function create_worker(): BackendWorkerClient & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async (task: BackendWorkerTask) => ({
      rule_key: task.type === "quality_statistics" ? task.input.rule_key : "",
      snapshot_signature:
        task.type === "quality_statistics" ? task.input.completed_snapshot.snapshot_signature : "",
    })),
  } as unknown as BackendWorkerClient & { run: ReturnType<typeof vi.fn> };
}

/**
 * 默认变更模拟翻译批次，单测通过 overrides 表达其它写入来源。
 */
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

describe("QualityStatisticsCache", () => {
  it("同一依赖签名重复读取时复用统计结果", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(1);
  });

  it("同一依赖签名的并发请求合并到同一个 worker task", async () => {
    const cache_port = create_cache_read_port();
    // resolve_task 让两个 read 请求在同一个 pending promise 上等待。
    let resolve_task: (value: Record<string, unknown>) => void = () => undefined;
    const worker = {
      run: vi.fn(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            resolve_task = resolve;
          }),
      ),
    } as unknown as BackendWorkerClient & { run: ReturnType<typeof vi.fn> };
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    const first = cache.read("glossary");
    const second = cache.read("glossary");
    resolve_task({ matched_item_count: 1 });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ statistics: { matched_item_count: 1 } }),
      expect.objectContaining({ statistics: { matched_item_count: 1 } }),
    ]);
    expect(worker.run).toHaveBeenCalledTimes(1);
  });

  it("只改译文后读取 glossary 时不重新执行 worker", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    cache_port.items_value = [{ item_id: 1, src: "HP", dst: "体力", status: "PROCESSED" }];
    cache.applyChange(create_cache_change());
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(1);
  });

  it("只改译文后读取 post_replacement 时重新执行 worker", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("post_replacement");
    cache_port.items_value = [{ item_id: 1, src: "HP", dst: "体力", status: "PROCESSED" }];
    cache.applyChange(create_cache_change());
    await cache.read("post_replacement");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("只改状态后读取任意统计都不重新执行 worker", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    await cache.read("post_replacement");
    cache_port.items_value = [{ item_id: 1, src: "HP", dst: "生命值", status: "ERROR" }];
    cache.applyChange(
      create_cache_change({
        source: "proofreading_item_patch",
        items: {
          mode: "delta",
          changedIds: [1],
          deleteIds: [],
          fieldPatch: { status: "ERROR" },
          sourcePayloadMode: "field-patch",
        },
      }),
    );
    await cache.read("glossary");
    await cache.read("post_replacement");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("原文 full replace 后读取原文类规则会重新执行 worker", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    cache_port.items_value = [{ item_id: 1, src: "MP", dst: "魔力", status: "PROCESSED" }];
    cache.applyChange(
      create_cache_change({
        source: "translation_reset",
        items: { mode: "full", reason: "full-scope" },
      }),
    );
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("quality full change 后读取任意规则会重新执行 worker", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    cache.applyChange(
      create_cache_change({
        eventType: "project.quality.changed",
        source: "quality_rule_save_entries",
        affectedSections: ["quality"],
        items: { mode: "keep" },
        quality: { mode: "full" },
      }),
    );
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("clear 后同一依赖签名会重新执行 worker", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    cache.clear();
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });
});
