import { describe, expect, it } from "vitest";

import { UnknownQualityRuleTypeError } from "../shared/error";
import { QualityRule, normalize_text_preserve_mode } from "./quality";

describe("QualityRule", () => {
  it("只接受公开质量规则槽位", () => {
    expect(QualityRule.all().map((rule) => rule.kind)).toEqual([
      "glossary",
      "text_preserve",
      "pre_replacement",
      "post_replacement",
    ]);
    expect(() => QualityRule.from_json("legacy")).toThrowError(UnknownQualityRuleTypeError);
  });

  it("文本保护模式兼容历史大小写并尊重调用方默认值", () => {
    expect(normalize_text_preserve_mode(" CUSTOM ")).toBe("custom");
    expect(normalize_text_preserve_mode("unknown", "smart")).toBe("smart");
  });

  it("规则列表写入前清理字段并过滤坏项", () => {
    expect(
      QualityRule.normalize_entries([
        null,
        ["invalid"],
        { src: "   ", dst: "忽略" },
        {
          entry_id: " rule-1 ",
          src: " HP ",
          dst: " 生命值 ",
          info: " 属性 ",
          regex: 1,
          case_sensitive: 0,
        },
      ]),
    ).toEqual([
      {
        entry_id: "rule-1",
        src: "HP",
        dst: "生命值",
        info: "属性",
        regex: true,
        case_sensitive: false,
      },
    ]);
  });

  it("不同规则槽位保留各自的缺省启用态和模式", () => {
    expect(QualityRule.from_json("glossary").normalize_slice({})).toMatchObject({
      enabled: true,
      mode: "off",
    });
    expect(QualityRule.from_json("pre_replacement").normalize_slice({})).toMatchObject({
      enabled: false,
      mode: "off",
    });
    expect(
      QualityRule.from_json("text_preserve").normalize_slice({
        enabled: "false",
        mode: "CUSTOM",
      }),
    ).toMatchObject({ enabled: false, mode: "custom" });
  });
});
