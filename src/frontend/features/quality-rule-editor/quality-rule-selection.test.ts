import { describe, expect, it } from "vitest";

import {
  are_quality_rule_entry_ids_equal,
  reorder_selected_quality_rule_entries,
  resolve_quality_rule_entry_id,
} from "./quality-rule-selection";

describe("quality rule selection", () => {
  it("优先使用稳定 entry id，并为旧条目生成同样的回退 id", () => {
    expect(resolve_quality_rule_entry_id({ entry_id: "fixed", src: "A" }, 2)).toBe("fixed");
    expect(resolve_quality_rule_entry_id({ entry_id: " fixed ", src: "A" }, 2)).toBe(" fixed ");
    expect(resolve_quality_rule_entry_id({ src: " A " }, 2)).toBe("A::2");
  });

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
