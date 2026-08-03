import { describe, expect, it } from "vitest";

import { ensure_quality_rule_entry_ids } from "./quality-rule-entry-id";

describe("quality-rule-entry-id", () => {
  it("修剪已有 id 并为空 id 补齐可预测身份", () => {
    expect(
      ensure_quality_rule_entry_ids([
        { entry_id: " rule-1 ", src: "苹果" },
        { entry_id: "  ", src: "香蕉" },
      ]),
    ).toEqual([
      { entry_id: "rule-1", src: "苹果" },
      { entry_id: "香蕉::1", src: "香蕉" },
    ]);
  });

  it("拒绝显式身份与补齐身份冲突", () => {
    expect(() =>
      ensure_quality_rule_entry_ids([{ entry_id: "苹果::1", src: "香蕉" }, { src: "苹果" }]),
    ).toThrow("entry_id 重复");
  });
});
