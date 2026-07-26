import { describe, expect, it } from "vitest";

import {
  compare_quality_rule_text_value,
  create_quality_rule_keyword_matcher,
  resolve_quality_rule_statistics_badge_kind,
} from "./quality-rule-filtering";

describe("quality rule filtering", () => {
  it("按页面提供的文本投影执行关键词匹配", () => {
    const matcher = create_quality_rule_keyword_matcher(
      { keyword: "HELLO", is_regex: false },
      (entry: { src: string; info: string }) => `${entry.src}\n${entry.info}`,
    );

    expect(matcher.matches({ src: "hello", info: "" })).toBe(true);
    expect(matcher.matches({ src: "bye", info: "" })).toBe(false);
  });

  it("排序时保持空值在末尾", () => {
    expect(compare_quality_rule_text_value("", "A", "ascending")).toBeGreaterThan(0);
    expect(compare_quality_rule_text_value("A", "", "descending")).toBeLessThan(0);
  });

  it("从统计事实解析徽章状态", () => {
    const statistics_state = {
      matched_count_by_entry_id: { related: 2, missing: 0 },
      subset_parent_labels_by_entry_id: { related: ["parent"] },
    };
    const completed = new Set(["related", "missing"]);

    expect(resolve_quality_rule_statistics_badge_kind("related", statistics_state, completed)).toBe(
      "related",
    );
    expect(resolve_quality_rule_statistics_badge_kind("missing", statistics_state, completed)).toBe(
      "unmatched",
    );
  });
});
