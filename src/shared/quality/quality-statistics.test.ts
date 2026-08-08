import { describe, expect, it } from "vitest";

import type { ItemTextGroup } from "../item-text";
import {
  run_quality_statistics_task_sync,
  type QualityStatisticsTaskInput,
} from "./quality-statistics";

function text_groups(groups: string[][]): ItemTextGroup[] {
  return groups.map((group) =>
    group.map((text, index) => ({ field: index === 0 ? "src" : "name_src", text })),
  );
}

describe("run_quality_statistics_task_sync", () => {
  it("按 item 去重统计字面量与正则命中", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        { entry_id: "strasse", pattern: "STRASSE", pattern_kind: "literal", case_sensitive: false },
        { entry_id: "regex", pattern: "^foo\\d+$", pattern_kind: "regex", case_sensitive: false },
      ],
      text_groups: text_groups([["Die Straße", "Straße"], ["foo42"], ["none"]]),
    });

    expect(result.hits_by_entry_id).toEqual({ strasse: 1, regex: 1 });
  });

  it("同一 item 内多字段和重叠命中只计一个 hit", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        { entry_id: "aba", pattern: "aba", pattern_kind: "literal", case_sensitive: true },
        { entry_id: "ba", pattern: "ba", pattern_kind: "literal", case_sensitive: true },
      ],
      text_groups: text_groups([["ababa dialogue", "aba"]]),
    });

    expect(result.hits_by_entry_id).toEqual({ aba: 1, ba: 1 });
    expect(result.example_item_indexes_by_entry_id).toEqual({ aba: [0], ba: [0] });
  });

  it("从全部命中 item 中确定性保留最多两个 example", () => {
    const input = {
      rules: [{ entry_id: "term", pattern: "术语", pattern_kind: "literal", case_sensitive: true }],
      text_groups: text_groups(Array.from({ length: 20 }, (_, index) => [`第${index}处术语`])),
    } satisfies QualityStatisticsTaskInput;

    const first = run_quality_statistics_task_sync(input);
    const second = run_quality_statistics_task_sync(input);

    expect(first.hits_by_entry_id.term).toBe(20);
    expect(first.example_item_indexes_by_entry_id.term).toHaveLength(2);
    expect(first.example_item_indexes_by_entry_id.term).toEqual(
      second.example_item_indexes_by_entry_id.term,
    );
  });

  it("未命中时保留零 hit 和空 examples", () => {
    const result = run_quality_statistics_task_sync({
      rules: [{ entry_id: "term", pattern: "term", pattern_kind: "literal", case_sensitive: true }],
      text_groups: text_groups([["none"]]),
    });

    expect(result).toEqual({
      hits_by_entry_id: { term: 0 },
      example_item_indexes_by_entry_id: { term: [] },
    });
  });

  it("非法正则令统计失败", () => {
    expect(() =>
      run_quality_statistics_task_sync({
        rules: [{ entry_id: "broken", pattern: "(", pattern_kind: "regex", case_sensitive: false }],
        text_groups: text_groups([["foo"]]),
      }),
    ).toThrow();
  });
});
