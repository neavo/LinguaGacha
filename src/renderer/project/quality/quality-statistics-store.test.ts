import { describe, expect, it, vi } from "vitest";

import type { QualityStatisticsDependencySnapshot } from "@/project/quality/quality-statistics-auto";
import {
  buildQualityStatisticsCacheFromResults,
  createEmptyQualityStatisticsCacheSnapshot,
  createQualityStatisticsStore,
  isQualityStatisticsCacheReady,
  isQualityStatisticsCacheRunning,
  shouldRequestQualityStatisticsForeground,
  type QualityStatisticsCachePhase,
  type QualityStatisticsCacheSnapshot,
} from "@/project/quality/quality-statistics-store";

// 测试快照只保留一个有语义的规则，便于确认 phase helper 不依赖规则数量。
const TEST_STATISTICS_SNAPSHOT: QualityStatisticsDependencySnapshot = {
  text_source: "src",
  text_signature: "texts",
  dependency_signature: "deps",
  snapshot_signature: "snapshot",
  rules: [
    {
      key: "apple::0",
      dependency_signature: "apple",
      relation_label: "apple",
      token: "apple",
    },
  ],
};

/**
 * 构造指定 phase 的已完成缓存，用公开 builder 保持结果形状贴近真实运行态。
 */
function create_cache_with_phase(
  phase: QualityStatisticsCachePhase,
): QualityStatisticsCacheSnapshot {
  const current_cache = buildQualityStatisticsCacheFromResults({
    previous_cache: createEmptyQualityStatisticsCacheSnapshot(),
    current_snapshot: TEST_STATISTICS_SNAPSHOT,
    results: {
      "apple::0": {
        matched_item_count: 1,
        subset_parents: [],
      },
    },
  });

  return {
    ...current_cache,
    phase,
  };
}

describe("quality statistics cache helpers", () => {
  it("只允许 empty 缓存触发页面前台刷新", () => {
    expect(
      shouldRequestQualityStatisticsForeground(createEmptyQualityStatisticsCacheSnapshot()),
    ).toBe(true);

    (["scheduled", "running", "current", "failed"] satisfies QualityStatisticsCachePhase[]).forEach(
      (phase) => {
        expect(shouldRequestQualityStatisticsForeground(create_cache_with_phase(phase))).toBe(
          false,
        );
      },
    );
  });

  it("用 phase 派生页面可见状态", () => {
    expect(isQualityStatisticsCacheReady(create_cache_with_phase("current"))).toBe(true);
    expect(isQualityStatisticsCacheReady(create_cache_with_phase("running"))).toBe(false);
    expect(isQualityStatisticsCacheRunning(create_cache_with_phase("running"))).toBe(true);
    expect(isQualityStatisticsCacheRunning(create_cache_with_phase("scheduled"))).toBe(false);
  });

  it("updateCache 返回原对象时不通知订阅者", () => {
    const store = createQualityStatisticsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.updateCache("glossary", (cache) => {
      return cache;
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
