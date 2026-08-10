import { describe, expect, it } from "vitest";

import { QualityRule, normalize_text_preserve_mode } from "./quality";

describe("QualityRule", () => {
  it("只接受公开质量规则槽位", () => {
    expect(QualityRule.all().map((rule) => rule.kind)).toEqual([
      "glossary",
      "text_preserve",
      "pre_replacement",
      "post_replacement",
    ]);
    expect(() => QualityRule.from_json("legacy")).toThrowError(
      expect.objectContaining({ code: "quality.unknown_rule_type" }),
    );
  });

  it("文本保护模式兼容历史大小写并尊重调用方默认值", () => {
    expect(normalize_text_preserve_mode(" CUSTOM ")).toBe("custom");
    expect(normalize_text_preserve_mode("unknown", "smart")).toBe("smart");
  });

  it("各规则槽位只输出自身 canonical 字段", () => {
    expect(
      QualityRule.from_json("pre_replacement").normalize_entries([
        {
          entry_id: " rule-1 ",
          src: " HP ",
          dst: " 生命值 ",
          info: "丢弃",
          regex: true,
          case_sensitive: false,
        },
      ]),
    ).toEqual([
      {
        entry_id: "rule-1",
        src: "HP",
        dst: "生命值",
        regex: true,
        case_sensitive: false,
      },
    ]);
    expect(
      QualityRule.from_json("text_preserve").normalize_entry({ src: " <A> ", info: " 控制码 " }),
    ).toEqual({ src: "<A>", info: "控制码" });
  });

  it("错误字段类型和空 src 整批拒绝", () => {
    const rule = QualityRule.from_json("post_replacement");
    expect(() => rule.normalize_entries([null])).toThrow("Quality rule entry must be an object.");
    expect(() => rule.normalize_entries([{ src: "", dst: "x" }])).toThrow(
      "Quality rule src must not be empty.",
    );
    expect(() => rule.normalize_entries([{ src: "a", dst: 1 }])).toThrow(
      "Quality rule dst must be a string.",
    );
    expect(() => rule.normalize_entries([{ src: "a", dst: "b", regex: 1 }])).toThrow(
      "Quality rule regex must be a boolean.",
    );
  });

  it("不同规则槽位保留各自的缺省启用态和模式", () => {
    expect(QualityRule.from_json("glossary").normalize_enabled(undefined)).toBe(true);
    expect(QualityRule.from_json("pre_replacement").normalize_enabled(undefined)).toBe(false);
    expect(QualityRule.from_json("text_preserve").normalize_mode("CUSTOM")).toBe("custom");
  });
});
