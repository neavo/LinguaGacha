import { describe, expect, it } from "vitest";

import { buildProofreadingLookupQuery } from "./quality-rule-proofreading-query";

describe("buildProofreadingLookupQuery", () => {
  it("构造校对查找 query 时让文本保护规则使用正则语义", () => {
    expect(
      buildProofreadingLookupQuery({
        rule_type: "text_preserve",
        entry: { src: "\\d+", info: "" },
      }),
    ).toEqual({ keyword: "\\d+", is_regex: true, scope: "src" });
    expect(
      buildProofreadingLookupQuery({
        rule_type: "glossary",
        entry: { src: "魔法", dst: "魔法", info: "", case_sensitive: true },
      }),
    ).toEqual({ keyword: "魔法", is_regex: false, scope: "src" });
    expect(
      buildProofreadingLookupQuery({
        rule_type: "pre_replacement",
        entry: { src: "^HP", dst: "生命值", regex: true, case_sensitive: false },
      }),
    ).toEqual({ keyword: "^HP", is_regex: true, scope: "src" });
    expect(
      buildProofreadingLookupQuery({
        rule_type: "post_replacement",
        entry: { src: "生命值", dst: "HP", regex: false, case_sensitive: false },
      }),
    ).toEqual({ keyword: "生命值", is_regex: false, scope: "dst" });
  });
});
