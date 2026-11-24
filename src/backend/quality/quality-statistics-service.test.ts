import { describe, expect, it, vi } from "vitest";

import type { QualityRuleStatisticsCache } from "../cache/quality-rule-statistics-cache";
import { QualityStatisticsService } from "./quality-statistics-service";

function create_cache(): Pick<QualityRuleStatisticsCache, "read"> {
  return {
    read: vi.fn(async () => ({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 1, quality: 2 },
      statistics: {
        entry_ids: ["hp"],
        hits_by_entry_id: { hp: 1 },
        examples_by_entry_id: { hp: ["HP +10"] },
        subset_parents_by_entry_id: {},
      },
    })),
  };
}

describe("QualityStatisticsService", () => {
  it("收窄合法 rule key 后返回统计响应形状", async () => {
    const cache = create_cache();
    const service = new QualityStatisticsService({ cache });

    const result = await service.read({ rule_key: "glossary" });

    expect(cache.read).toHaveBeenCalledWith("glossary");
    expect(result).toEqual({
      projectPath: "E:/Project/demo.lg",
      statistics: {
        entry_ids: ["hp"],
        hits_by_entry_id: { hp: 1 },
        subset_parents_by_entry_id: {},
      },
    });
  });

  it("非法 rule key 仍由 query service 抛请求校验错误", async () => {
    const service = new QualityStatisticsService({
      cache: create_cache(),
    });

    await expect(service.read({ rule_key: "unknown" })).rejects.toMatchObject({
      code: "request.validation_failed",
    });
  });
});
