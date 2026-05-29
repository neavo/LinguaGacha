import { describe, expect, it } from "vitest";

import { AnalysisCache } from "./analysis-cache";

describe("AnalysisCache", () => {
  it("返回分析轻量块浅克隆并可替换", () => {
    const cache = new AnalysisCache();
    cache.replace({ candidate_count: 2, status_summary: { line: 1 } });

    expect(cache.readBlock()).toEqual({ candidate_count: 2, status_summary: { line: 1 } });
    cache.replace({ candidate_count: 0 });
    expect(cache.readBlock()).toEqual({ candidate_count: 0 });
  });
});
