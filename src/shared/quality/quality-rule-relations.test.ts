import { describe, expect, it } from "vitest";

import {
  analyze_quality_rule_relations,
  type QualityRuleRelationCandidate,
} from "./quality-rule-relations";

function candidates(srcs: string[]): QualityRuleRelationCandidate[] {
  return srcs.map((src, index) => ({
    entry_id: index.toString(),
    src,
    pattern_kind: "literal",
    case_sensitive: true,
  }));
}

describe("analyze_quality_rule_relations", () => {
  it("保留真实包含、等价形式和父文本顺序", () => {
    const result = analyze_quality_rule_relations([
      { entry_id: "erin", src: "艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "saint", src: "圣女艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "duplicate", src: "圣女艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "captain", src: "舰长艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "child", src: "JK", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "case-only", src: "Xｊｋ", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "nfkc", src: "XＪＫ", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "wide", src: "ＪＫ", pattern_kind: "literal", case_sensitive: true },
    ]);

    expect(result.subset_parents_by_entry_id).toMatchObject({
      erin: ["圣女艾琳", "舰长艾琳"],
      child: ["XＪＫ"],
      wide: ["XＪＫ"],
    });
    expect(result.groups).toEqual([
      ["erin", "saint", "duplicate", "captain"],
      ["child", "case-only", "nfkc", "wide"],
    ]);
  });

  it("缺少独立短词根时仍按公共连续词根合并", () => {
    const result = analyze_quality_rule_relations(candidates(["ドトール家", "ドトール伯爵家"]));

    expect(result.groups).toEqual([["0", "1"]]);
    expect(result.subset_parents_by_entry_id).toEqual({});
  });

  it("拒绝单字根和覆盖不足的偶然相似", () => {
    expect(analyze_quality_rule_relations(candidates(["甲家", "甲国"])).groups).toEqual([
      ["0"],
      ["1"],
    ]);
    expect(analyze_quality_rule_relations(candidates(["共通甲乙丙", "共通丁戊己"])).groups).toEqual(
      [["0"], ["1"]],
    );
    expect(
      analyze_quality_rule_relations(candidates(["共通甲", "共通乙", "丙共通丁戊己"])).groups,
    ).toEqual([["0", "1"], ["2"]]);
  });

  it("弱组超过十二条时不合并，但更具体的小组仍可形成", () => {
    const broad = "甲乙丙丁戊己庚辛壬癸子丑寅".split("").map((suffix) => `共同${suffix}`);
    expect(analyze_quality_rule_relations(candidates(broad)).groups).toEqual(
      broad.map((_src, index) => [index.toString()]),
    );

    const with_specific_pair = ["共同特甲", "共同特乙", ...broad.slice(2)];
    expect(analyze_quality_rule_relations(candidates(with_specific_pair)).groups[0]).toEqual([
      "0",
      "1",
    ]);
  });

  it("重叠词根按稳定优先级形成互斥组而不传递串联", () => {
    const input = candidates(["甲乙一", "甲乙丙丁", "丙丁二"]);

    expect(analyze_quality_rule_relations(input).groups).toEqual([["0", "1"], ["2"]]);
  });

  it("条目 ID 与对象原型成员同名时仍保留包含关系", () => {
    const result = analyze_quality_rule_relations([
      { entry_id: "toString", src: "艾琳", pattern_kind: "literal", case_sensitive: true },
      { entry_id: "parent", src: "圣女艾琳", pattern_kind: "literal", case_sensitive: true },
    ]);

    expect(result.subset_parents_by_entry_id["toString"]).toEqual(["圣女艾琳"]);
  });

  it("强组超过弱组上限时仍保持完整和原始顺序", () => {
    const input = candidates([
      "星海",
      ..."甲乙丙丁戊己庚辛壬癸子丑".split("").map((suffix) => `星海${suffix}`),
    ]);

    expect(analyze_quality_rule_relations(input).groups).toEqual([
      Array.from({ length: 13 }, (_value, index) => index.toString()),
    ]);
  });

  it("正则仅按完全相同的表达式和大小写配置分组", () => {
    const result = analyze_quality_rule_relations([
      { entry_id: "a", src: "A.+", pattern_kind: "regex", case_sensitive: false },
      { entry_id: "b", src: "A.+", pattern_kind: "regex", case_sensitive: false },
      { entry_id: "c", src: "A.+", pattern_kind: "regex", case_sensitive: true },
    ]);

    expect(result.groups).toEqual([["a", "b"], ["c"]]);
    expect(result.subset_parents_by_entry_id).toEqual({});
  });
});
