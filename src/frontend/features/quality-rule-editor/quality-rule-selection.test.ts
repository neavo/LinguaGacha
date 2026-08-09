import { describe, expect, it } from "vitest";

import {
  are_quality_rule_entry_ids_equal,
  reorder_selected_quality_rule_entries,
} from "./quality-rule-selection";

describe("quality rule selection", () => {
  it("比较有序选区", () => {
    expect(are_quality_rule_entry_ids_equal(["a", "b"], ["a", "b"])).toBe(true);
    expect(are_quality_rule_entry_ids_equal(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("保持选中组顺序并移动到目标行之后", () => {
    expect(
      reorder_selected_quality_rule_entries(
        ["A", "B", "C", "D"],
        ["a", "b", "c", "d"],
        ["b", "c"],
        "b",
        "d",
      ),
    ).toEqual(["A", "D", "B", "C"]);
  });
});
