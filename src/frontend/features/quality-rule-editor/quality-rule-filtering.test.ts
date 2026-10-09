import { describe, expect, it } from "vitest";
import type { AppTableSortState } from "@frontend/widgets/app-table/app-table-types";

import {
  build_quality_rule_filter_result,
  compare_quality_rule_text_value,
  resolve_quality_rule_hit_badge_kind,
} from "./quality-rule-filtering";

describe("quality rule filtering", () => {
  it("排序时保持空值在末尾", () => {
    expect(compare_quality_rule_text_value("", "A", "ascending")).toBeGreaterThan(0);
    expect(compare_quality_rule_text_value("A", "", "descending")).toBeLessThan(0);
  });

  it("从统计事实解析徽章状态", () => {
    const statistics_state = {
      hits_by_entry_id: { related: 2, missing: 0 },
      subset_parents_by_entry_id: { related: ["parent"] },
    };
    const completed = new Set(["related", "missing"]);

    expect(resolve_quality_rule_hit_badge_kind("related", statistics_state, completed)).toBe(
      "related",
    );
    expect(resolve_quality_rule_hit_badge_kind("missing", statistics_state, completed)).toBe(
      "unmatched",
    );
    expect(
      resolve_quality_rule_hit_badge_kind(
        "matched",
        {
          hits_by_entry_id: { matched: 1 },
          subset_parents_by_entry_id: { matched: [] },
        },
        new Set(["matched"]),
      ),
    ).toBe("matched");
    expect(resolve_quality_rule_hit_badge_kind("pending", statistics_state, completed)).toBeNull();
  });
});

const entries = [
  { entry_id: "a", src: "item 10", info: "fruit" },
  { entry_id: "b", src: "item 2", info: "fruit" },
  { entry_id: "c", src: "", info: "other" },
];
const options = {
  entries,
  filter_state: { keyword: "", scope: "info" as const, is_regex: false },
  sort_state: null,
  hit_sort_available: false,
  hit_state: { hits_by_entry_id: { a: 1, b: 3, c: 1 } },
  select_text: (entry: (typeof entries)[number], scope: "info") => entry[scope],
  compare_entries: (
    left: (typeof entries)[number],
    right: (typeof entries)[number],
    sort: AppTableSortState,
  ) => compare_quality_rule_text_value(left.src, right.src, sort.direction),
};
it("筛选保留身份和源位置，非法正则返回错误与空结果", () => {
  expect(
    build_quality_rule_filter_result({
      ...options,
      filter_state: { ...options.filter_state, keyword: "FRUIT" },
    }).visible_entries,
  ).toEqual([
    { entry: entries[0], entry_id: "a", source_index: 0 },
    { entry: entries[1], entry_id: "b", source_index: 1 },
  ]);
  const invalid = build_quality_rule_filter_result({
    ...options,
    filter_state: { ...options.filter_state, keyword: "[", is_regex: true },
  });
  expect(invalid.visible_entries).toEqual([]);
  expect(invalid.invalid_regex_message).toEqual(expect.any(String));
});
it("命中排序等待统计，等值按源顺序，文本自然排序保持空值在末尾", () => {
  const sorted = { ...options, sort_state: { column_id: "hit", direction: "descending" as const } };
  expect(
    build_quality_rule_filter_result(sorted).visible_entries.map((row) => row.entry_id),
  ).toEqual(["a", "b", "c"]);
  expect(
    build_quality_rule_filter_result({ ...sorted, hit_sort_available: true }).visible_entries.map(
      (row) => row.entry_id,
    ),
  ).toEqual(["b", "a", "c"]);
  expect(
    build_quality_rule_filter_result({
      ...options,
      sort_state: { column_id: "src", direction: "ascending" },
    }).visible_entries.map((row) => row.entry_id),
  ).toEqual(["b", "a", "c"]);
  expect(entries.map((entry) => entry.entry_id)).toEqual(["a", "b", "c"]);
});
