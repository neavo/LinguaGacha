import { describe, expect, it } from "vitest";

import {
  QualityRule,
  QUALITY_RULE_KINDS,
  QUALITY_RULE_BUSINESS_SCHEMAS,
  normalize_text_preserve_mode,
} from "./quality";
import { Check } from "typebox/value";

describe("QualityRule", () => {
  it.each(QUALITY_RULE_KINDS)("%s 的 src 约束拒绝空白与错误类型，合法字符串统一裁剪", (kind) => {
    const rule = QualityRule.from_json(kind);
    const valid = rule.normalize_entry({ src: " \t合法\u3000 ", entry_id: " " });
    expect(valid.src).toBe("合法");
    expect(valid).not.toHaveProperty("entry_id");
    expect(Check(QUALITY_RULE_BUSINESS_SCHEMAS[kind], valid)).toBe(true);
    for (const src of ["", " \t\n\u3000", 12, null, false]) {
      expect(Check(QUALITY_RULE_BUSINESS_SCHEMAS[kind], { ...valid, src })).toBe(false);
      expect(() => rule.normalize_entries([valid, { ...valid, src }])).toThrow(TypeError);
    }
  });
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
    for (const entry of [
      null,
      { src: "", dst: "x" },
      { src: "a", dst: 1 },
      { src: "a", dst: "b", regex: 1 },
    ]) {
      expect(() => rule.normalize_entries([entry])).toThrow(TypeError);
    }
  });

  it("只有文本保护槽位采用保护模式", () => {
    expect(QualityRule.from_json("text_preserve").normalize_mode("CUSTOM")).toBe("custom");
    expect(QualityRule.from_json("glossary").normalize_mode("custom")).toBe("off");
  });
});
