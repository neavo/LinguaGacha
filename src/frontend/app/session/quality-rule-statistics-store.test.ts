import { describe, expect, it, vi } from "vitest";

import type { QualityStatisticsDependencySnapshot } from "@shared/quality/quality-statistics";
import {
  createEmptyQualityRuleStatisticsCacheSnapshot,
  createQualityRuleStatisticsStore,
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  resolveQualityRuleStatisticsRulesToExpire,
  shouldRequestQualityRuleStatisticsForeground,
  type QualityRuleStatisticsCachePhase,
  type QualityRuleStatisticsCacheSnapshot,
  type QualityRuleStatisticsProjectChangeSignal,
} from "@frontend/app/session/quality-rule-statistics-store";

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
  phase: QualityRuleStatisticsCachePhase,
): QualityRuleStatisticsCacheSnapshot {
  return {
    ...createEmptyQualityRuleStatisticsCacheSnapshot(),
    phase,
    current_snapshot: TEST_STATISTICS_SNAPSHOT,
    completed_snapshot: TEST_STATISTICS_SNAPSHOT,
    completed_entry_ids: ["apple::0"],
    matched_count_by_entry_id: { "apple::0": 1 },
    subset_parent_labels_by_entry_id: { "apple::0": [] },
    updated_at: Date.now(),
  };
}

/**
 * 默认信号模拟翻译批次，单测通过 overrides 表达其它项目变更来源。
 */
function create_project_change_signal(
  overrides: Partial<QualityRuleStatisticsProjectChangeSignal> = {},
): QualityRuleStatisticsProjectChangeSignal {
  return {
    seq: 1,
    updated_sections: ["items"],
    results: [
      {
        source: "translation_batch_update",
        updatedSections: ["items"],
        itemDelta: {
          upsertItemIds: [1],
          deleteItemIds: [],
          fullReplace: false,
        },
      },
    ],
    ...overrides,
  };
}

describe("quality rule statistics cache helpers", () => {
  it("页面前台刷新只补算空缓存和待刷新缓存", () => {
    expect(
      shouldRequestQualityRuleStatisticsForeground(createEmptyQualityRuleStatisticsCacheSnapshot()),
    ).toBe(true);

    (["scheduled"] satisfies QualityRuleStatisticsCachePhase[]).forEach((phase) => {
      expect(shouldRequestQualityRuleStatisticsForeground(create_cache_with_phase(phase))).toBe(
        true,
      );
    });

    (["running", "current", "failed"] satisfies QualityRuleStatisticsCachePhase[]).forEach(
      (phase) => {
        expect(shouldRequestQualityRuleStatisticsForeground(create_cache_with_phase(phase))).toBe(
          false,
        );
      },
    );
  });

  it("用 phase 计算页面可见状态", () => {
    expect(isQualityRuleStatisticsCacheReady(create_cache_with_phase("current"))).toBe(true);
    expect(isQualityRuleStatisticsCacheReady(create_cache_with_phase("running"))).toBe(false);
    expect(isQualityRuleStatisticsCacheRunning(create_cache_with_phase("running"))).toBe(true);
    expect(isQualityRuleStatisticsCacheRunning(create_cache_with_phase("scheduled"))).toBe(false);
  });

  it("updateCache 返回原对象时不通知订阅者", () => {
    const store = createQualityRuleStatisticsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.updateCache("glossary", (cache) => {
      return cache;
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("quality 变化会让四类统计全部过期", () => {
    expect(
      resolveQualityRuleStatisticsRulesToExpire(
        create_project_change_signal({
          updated_sections: ["quality"],
          results: [],
        }),
      ),
    ).toEqual(["glossary", "pre_replacement", "post_replacement", "text_preserve"]);
  });

  it.each([["translation_batch_update"], ["retranslate_items"]] as const)(
    "翻译写入来源 %s 只让后置替换统计过期",
    (source) => {
      expect(
        resolveQualityRuleStatisticsRulesToExpire(
          create_project_change_signal({
            results: [
              {
                source,
                updatedSections: ["items"],
                itemDelta: {
                  upsertItemIds: [1],
                  deleteItemIds: [],
                  fullReplace: false,
                },
              },
            ],
          }),
        ),
      ).toEqual(["post_replacement"]);
    },
  );

  it("只修改状态字段时保留所有统计缓存", () => {
    expect(
      resolveQualityRuleStatisticsRulesToExpire(
        create_project_change_signal({
          results: [
            {
              source: "proofreading_item_patch",
              updatedSections: ["items"],
              itemDelta: {
                upsertItemIds: [1],
                deleteItemIds: [],
                fullReplace: false,
                fieldPatch: { status: "PROCESSED" },
              },
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("修改译文字段时只让后置替换统计过期", () => {
    expect(
      resolveQualityRuleStatisticsRulesToExpire(
        create_project_change_signal({
          results: [
            {
              source: "proofreading_item_patch",
              updatedSections: ["items"],
              itemDelta: {
                upsertItemIds: [1],
                deleteItemIds: [],
                fullReplace: false,
                fieldPatch: { dst: "新译文" },
              },
            },
          ],
        }),
      ),
    ).toEqual(["post_replacement"]);
  });

  it("items 全量替换会让四类统计全部过期", () => {
    expect(
      resolveQualityRuleStatisticsRulesToExpire(
        create_project_change_signal({
          results: [
            {
              source: "translation_reset",
              updatedSections: ["items"],
              itemDelta: {
                upsertItemIds: [1],
                deleteItemIds: [],
                fullReplace: true,
              },
            },
          ],
        }),
      ),
    ).toEqual(["glossary", "pre_replacement", "post_replacement", "text_preserve"]);
  });

  it("items 变化缺少行级载荷时让四类统计全部过期", () => {
    expect(
      resolveQualityRuleStatisticsRulesToExpire(
        create_project_change_signal({
          results: [
            {
              source: "unknown_items_change",
              updatedSections: ["items"],
            },
          ],
        }),
      ),
    ).toEqual(["glossary", "pre_replacement", "post_replacement", "text_preserve"]);
  });
});
