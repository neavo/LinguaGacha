import { describe, expect, it } from "vitest";

import { build_glossary_filter_result } from "./filtering";

const hit_state = {
  running: false,
  completed_snapshot: null,
  completed_entry_ids: [],
  matched_count_by_entry_id: {},
  subset_parent_labels_by_entry_id: {},
};

describe("glossary filtering", () => {
  it("按术语页字段范围过滤，并保留对应稳定 ID", () => {
    const result = build_glossary_filter_result({
      entries: [
        { src: "apple", dst: "苹果", info: "fruit", case_sensitive: false },
        { src: "pear", dst: "梨", info: "food", case_sensitive: true },
      ],
      entry_ids: ["apple-id", "pear-id"],
      filter_state: { keyword: "fruit", scope: "info", is_regex: false },
      sort_state: { field: null, direction: null },
      hit_sort_available: false,
      hit_state,
    });

    expect(result.invalid_regex_message).toBeNull();
    expect(result.visible_entries.map((entry) => entry.entry_id)).toEqual(["apple-id"]);
  });

  it("规则排序相同时回落到源顺序", () => {
    const result = build_glossary_filter_result({
      entries: [
        { src: "B", dst: "", info: "", case_sensitive: true },
        { src: "A", dst: "", info: "", case_sensitive: false },
        { src: "C", dst: "", info: "", case_sensitive: false },
      ],
      entry_ids: ["b", "a", "c"],
      filter_state: { keyword: "", scope: "all", is_regex: false },
      sort_state: { field: "rule", direction: "ascending" },
      hit_sort_available: false,
      hit_state,
    });

    expect(result.visible_entries.map((entry) => entry.entry_id)).toEqual(["a", "c", "b"]);
  });
});
