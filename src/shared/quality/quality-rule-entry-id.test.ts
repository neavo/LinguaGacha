import { describe, expect, it } from "vitest";

import {
  build_legacy_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
  normalize_quality_rule_entry_id,
} from "./quality-rule-entry-id";

describe("quality-rule-entry-id", () => {
  it("保留已有稳定 id 并为旧规则补齐可预测 id", () => {
    expect(
      ensure_quality_rule_entry_ids([{ entry_id: " rule-1 ", src: "苹果" }, { src: "香蕉" }]),
    ).toEqual([
      { entry_id: "rule-1", src: "苹果" },
      { entry_id: "香蕉::1", src: "香蕉" },
    ]);
  });

  it("旧规则 fallback id 只依赖当前行源文和位置", () => {
    expect(build_legacy_quality_rule_entry_id({ src: " 苹果 " }, 3)).toBe("苹果::3");
    expect(normalize_quality_rule_entry_id("  ")).toBeNull();
  });
});
