import { describe, expect, it } from "vitest";

import { buildGlossaryStatisticsState } from "./use-glossary-page-state";

describe("buildGlossaryStatisticsState", () => {
  it("把统计结果映射成按条目索引的状态", () => {
    const state = buildGlossaryStatisticsState({
      snapshot: {
        text_source: "src",
        text_signature: "texts",
        dependency_signature: "deps",
        snapshot_signature: "snapshot",
        rules: [
          {
            key: "苹果|1",
            dependency_signature: "苹果",
            relation_label: "苹果",
            token: "苹果",
          },
        ],
      },
      completed_entry_ids: ["苹果|1"],
      results: {
        "苹果|1": {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    });

    expect(state.completed_snapshot?.snapshot_signature).toBe("snapshot");
    expect(state.matched_count_by_entry_id["苹果|1"]).toBe(1);
  });
});
