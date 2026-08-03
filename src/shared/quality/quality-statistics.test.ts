import { describe, expect, it } from "vitest";

import type { ItemTextGroup } from "../item-text";
import { run_quality_statistics_task_sync } from "./quality-statistics";

function text_groups(groups: string[][]): ItemTextGroup[] {
  return groups.map((group) =>
    group.map((text, index) => ({ field: index === 0 ? "src" : "name_src", text })),
  );
}

describe("run_quality_statistics_task_sync", () => {
  it("按 item 去重统计字面量与正则，并统一 Unicode 字面量语义", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "strasse",
          pattern: "STRASSE",
          pattern_kind: "literal",
          case_sensitive: false,
        },
        {
          entry_id: "regex",
          pattern: "^foo\\d+$",
          pattern_kind: "regex",
          case_sensitive: false,
        },
      ],
      text_groups: text_groups([["Die Straße", "Straße"], ["foo42"], ["none"]]),
      relation_candidates: [],
    });

    expect(result.results.strasse?.matched_item_count).toBe(1);
    expect(result.results.regex?.matched_item_count).toBe(1);
  });

  it("非法正则令统计失败", () => {
    expect(() =>
      run_quality_statistics_task_sync({
        rules: [
          {
            entry_id: "broken",
            pattern: "(",
            pattern_kind: "regex",
            case_sensitive: false,
          },
        ],
        text_groups: text_groups([["foo"]]),
        relation_candidates: [],
      }),
    ).toThrow();
  });

  it("包含关系只消费显式字面量候选并保持父文本去重顺序", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "erin",
          pattern: "艾琳",
          pattern_kind: "literal",
          case_sensitive: true,
        },
        {
          entry_id: "regex",
          pattern: "艾.+",
          pattern_kind: "regex",
          case_sensitive: false,
        },
      ],
      text_groups: [],
      relation_candidates: [
        { entry_id: "erin", src: "艾琳" },
        { entry_id: "saint", src: "圣女艾琳" },
        { entry_id: "duplicate", src: "圣女艾琳" },
        { entry_id: "captain", src: "舰长艾琳" },
      ],
    });

    expect(result.results.erin?.subset_parents).toEqual(["圣女艾琳", "舰长艾琳"]);
    expect(result.results.regex?.subset_parents).toEqual([]);
  });
});
