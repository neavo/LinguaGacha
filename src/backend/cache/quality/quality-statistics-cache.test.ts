import { describe, expect, it, vi } from "vitest";

import type { BackendWorkerClient } from "../../worker/worker-client";
import type { CacheReadPort } from "../cache-types";
import { QualityStatisticsCache } from "./quality-statistics-cache";

function create_cache_read_port(): CacheReadPort & {
  revisions: Record<string, number>;
  items_value: Array<Record<string, unknown>>;
} {
  return {
    revisions: { items: 1, quality: 1 },
    items_value: [{ item_id: 1, src: "HP", dst: "生命值" }],
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
      readItems: () => [{ item_id: 1, src: "HP", dst: "生命值" }],
      readItem: () => null,
    },
    files: {
      readFileEntries: () => [],
    },
    quality: {
      readBlock: () => ({
        glossary: {
          entries: [{ src: "HP", dst: "生命值" }],
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
}

function create_worker(): BackendWorkerClient & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async () => ({ matched_item_count: 1 })),
  } as unknown as BackendWorkerClient & { run: ReturnType<typeof vi.fn> };
}

describe("QualityStatisticsCache", () => {
  it("同一 cache key 复用统计结果", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(1);
  });

  it("同一 cache key 的并发请求合并到同一个 worker task", async () => {
    const cache_port = create_cache_read_port();
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

  it("items 或 quality revision 变化会重新计算", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    cache_port.revisions = { items: 2, quality: 1 };
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });

  it("clear 后同一 key 会重新计算", async () => {
    const cache_port = create_cache_read_port();
    const worker = create_worker();
    const cache = new QualityStatisticsCache({ cache: cache_port, workerClient: worker });

    await cache.read("glossary");
    cache.clear();
    await cache.read("glossary");

    expect(worker.run).toHaveBeenCalledTimes(2);
  });
});
