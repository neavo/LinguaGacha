import { describe, expect, it } from "vitest";

import {
  QUALITY_RULE_TYPES,
  build_quality_rule_revision_key,
  normalize_quality_rule_type,
  normalize_text_preserve_mode,
  resolve_quality_rule_database_type,
  resolve_quality_rule_enabled_meta_key,
} from "./quality";

describe("quality 基础模型", () => {
  it("集中维护公开规则类型到数据库和 meta 的映射", () => {
    expect(QUALITY_RULE_TYPES).toEqual([
      "glossary",
      "text_preserve",
      "pre_replacement",
      "post_replacement",
    ]);
    expect(resolve_quality_rule_database_type("pre_replacement")).toBe(
      "pre_translation_replacement",
    );
    expect(resolve_quality_rule_enabled_meta_key("text_preserve")).toBeNull();
    expect(build_quality_rule_revision_key("post_replacement")).toBe(
      "quality_rule_revision.post_replacement",
    );
  });

  it("规范化文本保护模式并拒绝未知规则类型", () => {
    expect(normalize_text_preserve_mode("smart")).toBe("smart");
    expect(normalize_text_preserve_mode("CUSTOM")).toBe("custom");
    expect(normalize_text_preserve_mode("bad")).toBe("off");
    expect(normalize_quality_rule_type("glossary")).toBe("glossary");
    expect(() => normalize_quality_rule_type("legacy")).toThrow("未知的质量规则类型");
  });
});
