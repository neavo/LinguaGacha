import { describe, expect, it } from "vitest";

import {
  are_quality_rule_entry_ids_equal,
  can_reorder_quality_rule_entries,
  order_quality_rule_entries_by_id,
  resolve_quality_rule_boolean_menu_state,
  resolve_quality_rule_insert_after_entry_id,
} from "./quality-rule-selection";

describe("quality rule selection", () => {
  it("比较有序选区", () => {
    expect(are_quality_rule_entry_ids_equal(["a", "b"], ["a", "b"])).toBe(true);
    expect(are_quality_rule_entry_ids_equal(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("按表格最终身份顺序投影规则条目", () => {
    expect(
      order_quality_rule_entries_by_id(
        ["A", "B", "C", "D"],
        ["a", "b", "c", "d"],
        ["a", "d", "b", "c"],
      ),
    ).toEqual(["A", "D", "B", "C"]);
  });

  it.each([
    { readonly: false, has_active_query: false, visible_entry_ids: ["a", "b"], expected: true },
    { readonly: true, has_active_query: false, visible_entry_ids: ["a", "b"], expected: false },
    { readonly: false, has_active_query: true, visible_entry_ids: ["a", "b"], expected: false },
    { readonly: false, has_active_query: false, visible_entry_ids: ["a"], expected: false },
    { readonly: false, has_active_query: false, visible_entry_ids: ["b", "a"], expected: false },
  ])("只在可见结果完整反映权威顺序时开放重排", (input) => {
    expect(
      can_reorder_quality_rule_entries({
        ...input,
        ordered_entry_ids: ["a", "b"],
      }),
    ).toBe(input.expected);
  });

  it("活动行失效时从选区末尾选择仍存在的插入位置", () => {
    const valid_entry_ids = new Set(["a", "c"]);

    expect(
      resolve_quality_rule_insert_after_entry_id("missing", ["a", "b", "c"], valid_entry_ids),
    ).toBe("c");
    expect(resolve_quality_rule_insert_after_entry_id("a", ["c"], valid_entry_ids)).toBe("a");
  });

  it("批量布尔菜单区分统一状态与混合状态", () => {
    const entry_by_id = new Map([
      ["a", { enabled: true }],
      ["b", { enabled: false }],
    ]);
    const resolve_state = (target_entry_ids: string[]) =>
      resolve_quality_rule_boolean_menu_state({
        entry_by_id,
        target_entry_ids,
        pick_value: (entry) => entry.enabled,
      });

    expect(resolve_state(["a"])).toBe("enabled");
    expect(resolve_state(["b"])).toBe("disabled");
    expect(resolve_state(["a", "missing", "b"])).toBe("mixed");
  });
});
