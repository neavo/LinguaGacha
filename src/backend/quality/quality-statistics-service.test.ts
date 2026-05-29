import { describe, expect, it, vi } from "vitest";

import type { QualityStatisticsCache } from "../cache/quality/quality-statistics-cache";
import { ProjectSessionState } from "../project/project-session";
import * as AppErrors from "../../shared/error";
import { QualityStatisticsService } from "./quality-statistics-service";

function create_cache(): QualityStatisticsCache {
  return {
    read: vi.fn(async () => ({
      projectPath: "E:/Project/demo.lg",
      sectionRevisions: { items: 1, quality: 2 },
      statistics: { matched_item_count: 1 },
    })),
  } as unknown as QualityStatisticsCache;
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
      sectionRevisions: { items: 1, quality: 2 },
      statistics: { matched_item_count: 1 },
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
