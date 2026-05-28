import { describe, expect, it, vi } from "vitest";

import { create_quality_rule_duplicate_resolution_plan } from "./quality-rule-import-confirmation";

describe("quality-rule-import-confirmation", () => {
  it("创建重复项解决计划时克隆条目并保留生命周期回调", () => {
    const before_pending = vi.fn();
    const before_apply = vi.fn();
    const existing_entries = [{ src: "魔法", dst: "Magic" }];
    const incoming_entries = [{ src: "勇者", dst: "Hero" }];

    const plan = create_quality_rule_duplicate_resolution_plan({
      existing_entries,
      incoming_entries,
      skip_entries: incoming_entries,
      overwrite_entries: existing_entries,
      before_pending,
      before_apply,
    });
    existing_entries[0].src = "污染";
    incoming_entries[0].dst = "Dirty";

    expect(plan.existing_entries).toEqual([{ src: "魔法", dst: "Magic" }]);
    expect(plan.incoming_entries).toEqual([{ src: "勇者", dst: "Hero" }]);
    expect(plan.skip_entries).toEqual([{ src: "勇者", dst: "Hero" }]);
    expect(plan.overwrite_entries).toEqual([{ src: "魔法", dst: "Magic" }]);
    expect(plan.before_pending).toBe(before_pending);
    expect(plan.before_apply).toBe(before_apply);
  });

  it("保留 null skip_entries 表达用户选择跳过时不写入", () => {
    const plan = create_quality_rule_duplicate_resolution_plan({
      existing_entries: [],
      incoming_entries: [],
      skip_entries: null,
    });

    expect(plan.skip_entries).toBeNull();
  });
});
