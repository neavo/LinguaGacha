import { describe, expect, it } from "vitest";

import { find_quality_rule_subset_parents } from "./quality-rule-subset-parents";

describe("find_quality_rule_subset_parents", () => {
  it("保留真实包含父项并复用正式字面匹配语义", () => {
    const result = find_quality_rule_subset_parents([
      { entry_id: "erin", src: "艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "saint", src: "圣女艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "captain", src: "舰长艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "child", src: "JK", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "case-only", src: "Xｊｋ", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "nfkc", src: "XＪＫ", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "wide", src: "ＪＫ", pattern_kind: "literal", case_sensitive: true },
    ]);

    expect(result).toMatchObject({
      erin: ["圣女艾琳", "舰长艾琳"],
      child: ["XＪＫ"],
      wide: ["XＪＫ"],
    });
  });

  it("忽略完全等价与正则规则", () => {
    const result = find_quality_rule_subset_parents([
      { entry_id: "first", src: "ＪＫ", pattern_kind: "literal", case_sensitive: false },
      { entry_id: "equal", src: "jk", pattern_kind: "literal", case_sensitive: false },
      { entry_id: "regex", src: "JK", pattern_kind: "regex", case_sensitive: false },
    ]);

    expect(result).toEqual({});
  });

  it("条目 ID 与对象原型成员同名时仍返回包含关系", () => {
    const result = find_quality_rule_subset_parents([
      { entry_id: "toString", src: "艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "parent", src: "圣女艾琳", pattern_kind: "literal", case_sensitive: true },
    ]);

    expect(result["toString"]).toEqual(["圣女艾琳"]);
  });
});
