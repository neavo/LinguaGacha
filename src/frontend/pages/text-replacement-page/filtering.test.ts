import { describe, expect, it } from "vitest";

import { build_text_replacement_filter_result, sort_text_replacement_entries } from "./filtering";

describe("text replacement filtering", () => {
  it("按替换文本范围过滤，并保留对应稳定 ID", () => {
    const result = build_text_replacement_filter_result({
      entries: [
        { entry_id: "apple", src: "A", dst: "apple", regex: false, case_sensitive: false },
        { entry_id: "banana", src: "B", dst: "banana", regex: true, case_sensitive: true },
      ],
      entry_ids: ["apple", "banana"],
      filter_state: { keyword: "banana", scope: "dst", is_regex: false },
    });

    expect(result.invalid_regex_message).toBeNull();
    expect(result.visible_entries.map((entry) => entry.entry_id)).toEqual(["banana"]);
  });

  it("规则排序按 regex 后 case_sensitive 的组合值排列", () => {
    const entries = [
      {
        entry: { entry_id: "regex", src: "A", dst: "", regex: true, case_sensitive: false },
        entry_id: "regex",
        source_index: 0,
      },
      {
        entry: { entry_id: "case", src: "B", dst: "", regex: false, case_sensitive: true },
        entry_id: "case",
        source_index: 1,
      },
      {
        entry: { entry_id: "plain", src: "C", dst: "", regex: false, case_sensitive: false },
        entry_id: "plain",
        source_index: 2,
      },
    ];

    expect(
      sort_text_replacement_entries(entries, { column_id: "rule", direction: "ascending" }, false, {
        running: false,
        entry_ids: [],
        hits_by_entry_id: {},
        subset_parents_by_entry_id: {},
      }).map((entry) => entry.entry_id),
    ).toEqual(["plain", "case", "regex"]);
  });
});
