import { describe, expect, it } from "vitest";

import { buildProofreadingLookupQuery } from "./state";

describe("quality-state", () => {
  it("构造校对查找 query 时让文本保护规则使用正则语义", () => {
    expect(
      buildProofreadingLookupQuery({
        rule_type: "text_preserve",
        entry: { src: "\\d+", regex: false },
      }),
    ).toEqual({ keyword: "\\d+", is_regex: true });
    expect(
      buildProofreadingLookupQuery({
        rule_type: "glossary",
        entry: { src: "魔法", regex: false },
      }),
    ).toEqual({ keyword: "魔法", is_regex: false });
  });
});
