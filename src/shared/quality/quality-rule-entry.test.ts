import { describe, expect, it } from "vitest";

import { QualityRule } from "../../domain/quality";
import { normalize_quality_rule_entries } from "./quality-rule-entry";

describe("normalize_quality_rule_entries", () => {
  it("按具体规则裁剪字段并执行真实编译校验", () => {
    expect(
      normalize_quality_rule_entries(QualityRule.from_json("pre_replacement"), [
        { src: " HP ", dst: " 生命值 ", regex: false, case_sensitive: true, info: "丢弃" },
      ]),
    ).toEqual([{ src: "HP", dst: "生命值", regex: false, case_sensitive: true }]);

    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("post_replacement"), [
        { src: "(", dst: "x", regex: true, case_sensitive: false },
      ]),
    ).toThrow("质量规则正则不是合法正则");
    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("text_preserve"), [
        { src: "(", info: "" },
      ]),
    ).toThrow("质量规则正则不是合法正则");
  });

  it("拒绝归一后身份重复的整批规则", () => {
    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("pre_replacement"), [
        { entry_id: "same", src: "HP", dst: "生命值" },
        { entry_id: " same ", src: "MP", dst: "魔力值" },
      ]),
    ).toThrow("entry_id 重复");
  });
});
