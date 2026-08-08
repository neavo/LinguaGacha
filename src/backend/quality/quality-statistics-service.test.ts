import { describe, expect, it, vi } from "vitest";

import type { QualityRuleAnalysisCache } from "../cache/quality-rule-analysis-cache";
import { ProjectSessionState } from "../project/project-session-state";
import * as AppErrors from "../../shared/error";
import { QualityStatisticsService } from "./quality-statistics-service";

function create_cache(): Pick<QualityRuleAnalysisCache, "read"> {
  return {
    read: vi.fn(async () => ({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 1, quality: 2 },
      analysis: {
        entry_ids: ["hp"],
        hits_by_entry_id: { hp: 1 },
        examples_by_entry_id: { hp: ["HP +10"] },
        relations: { subset_parents_by_entry_id: {}, groups: [["hp"]] },
      },
    })),
  };
}

describe("QualityStatisticsService", () => {
  it("收窄合法 rule key 后返回统计响应形状", async () => {
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const cache = create_cache();
    const service = new QualityStatisticsService({ sessionState: session_state, cache });

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
    const session_state = new ProjectSessionState();
    session_state.mark_loaded("E:/Project/demo.lg");
    const service = new QualityStatisticsService({
      sessionState: session_state,
      cache: create_cache(),
    });

    await expect(service.read({ rule_key: "unknown" })).rejects.toBeInstanceOf(
      AppErrors.RequestValidationError,
    );
  });

  it("未加载工程时不读取统计缓存", async () => {
    const cache = create_cache();
    const service = new QualityStatisticsService({
      sessionState: new ProjectSessionState(),
      cache,
    });

    await expect(service.read({ rule_key: "glossary" })).rejects.toBeInstanceOf(
      AppErrors.ProjectNotLoadedError,
    );
    expect(cache.read).not.toHaveBeenCalled();
  });
});
