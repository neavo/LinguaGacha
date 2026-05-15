import { describe, expect, it } from "vitest";

import { is_app_error } from "../shared/error";
import { QualityRule, normalize_text_preserve_mode } from "./quality";

describe("quality 基础模型", () => {
  it("集中维护公开规则类型到数据库和 meta 的映射", () => {
    expect(QualityRule.all().map((rule) => rule.kind)).toEqual([
      "glossary",
      "text_preserve",
      "pre_replacement",
      "post_replacement",
    ]);
    expect(QualityRule.from_json("pre_replacement").database_type).toBe(
      "pre_translation_replacement",
    );
    expect(QualityRule.from_json("text_preserve").enabled_meta_key).toBeNull();
    expect(QualityRule.from_json("post_replacement").revision_meta_key).toBe(
      "quality_rule_revision.post_replacement",
    );
  });

  it("规范化文本保护模式并拒绝未知规则类型", () => {
    expect(normalize_text_preserve_mode("smart")).toBe("smart");
    expect(normalize_text_preserve_mode("CUSTOM")).toBe("custom");
    expect(normalize_text_preserve_mode("bad")).toBe("off");
    expect(QualityRule.from_json("glossary").kind).toBe("glossary");
    let code: string | null = null;
    try {
      QualityRule.from_json("legacy");
    } catch (error) {
      code = is_app_error(error) ? error.code : null;
    }
    expect(code).toBe("quality.unknown_rule_type");
  });
});
