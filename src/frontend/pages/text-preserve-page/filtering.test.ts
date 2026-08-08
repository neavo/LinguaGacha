import { describe, expect, it } from "vitest";

import { build_text_preserve_filter_result, sort_text_preserve_entries } from "./filtering";

describe("text preserve filtering", () => {
  it("按备注范围过滤，并保留对应稳定 ID", () => {
    const result = build_text_preserve_filter_result({
      entries: [
        { src: "\\N", info: "line break" },
        { src: "\\C", info: "color" },
      ],
      entry_ids: ["newline", "color"],
      filter_state: { keyword: "break", scope: "info", is_regex: false },
    });

    expect(result.invalid_regex_message).toBeNull();
    expect(result.visible_entries.map((entry) => entry.entry_id)).toEqual(["newline"]);
  });

  it("统计就绪后按命中数排序，命中数相同时保持源顺序", () => {
    const entries = [
      { entry: { src: "A", info: "" }, entry_id: "a", source_index: 0 },
      { entry: { src: "B", info: "" }, entry_id: "b", source_index: 1 },
      { entry: { src: "C", info: "" }, entry_id: "c", source_index: 2 },
    ];

    expect(
      sort_text_preserve_entries(entries, { column_id: "hit", direction: "descending" }, true, {
        running: false,
        entry_ids: ["a", "b", "c"],
        hits_by_entry_id: { a: 1, b: 3, c: 1 },
      }).map((entry) => entry.entry_id),
    ).toEqual(["b", "a", "c"]);
  });
});
