import { describe, expect, it, vi } from "vitest";

import { QualityRule } from "../../domain/quality";
import {
  create_quality_rule_entries,
  create_quality_rule_entry_id,
  normalize_quality_rule_entries,
} from "./quality-rule-entry";

describe("normalize_quality_rule_entries", () => {
  it("按具体规则裁剪字段并执行真实编译校验", () => {
    expect(
      normalize_quality_rule_entries(QualityRule.from_json("pre_replacement"), [
        {
          entry_id: " rule-1 ",
          src: " HP ",
          dst: " 生命值 ",
          regex: false,
          case_sensitive: true,
          info: "丢弃",
        },
      ]),
    ).toEqual([
      {
        entry_id: "rule-1",
        src: "HP",
        dst: "生命值",
        regex: false,
        case_sensitive: true,
      },
    ]);

    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("post_replacement"), [
        { entry_id: "broken", src: "(", dst: "x", regex: true, case_sensitive: false },
      ]),
    ).toThrow("Quality rule regex is invalid.");
    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("text_preserve"), [
        { entry_id: "broken", src: "(", info: "" },
      ]),
    ).toThrow("Quality rule regex is invalid.");
  });

  it("拒绝归一后身份重复的整批规则", () => {
    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("pre_replacement"), [
        { entry_id: "same", src: "HP", dst: "生命值" },
        { entry_id: " same ", src: "MP", dst: "魔力值" },
      ]),
    ).toThrow("Duplicate quality rule entry_id");
  });

  it("拒绝缺失或空白身份", () => {
    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("glossary"), [
        { src: "苹果", dst: "Apple", info: "", case_sensitive: false },
      ]),
    ).toThrow("Quality rule entry_id must not be empty.");
    expect(() =>
      normalize_quality_rule_entries(QualityRule.from_json("glossary"), [
        { entry_id: "  ", src: "苹果", dst: "Apple", info: "", case_sensitive: false },
      ]),
    ).toThrow("Quality rule entry_id must not be empty.");
  });

  it("为无身份外部规则创建短身份并忽略外部身份", () => {
    const entries = create_quality_rule_entries(QualityRule.from_json("glossary"), [
      { entry_id: "external", src: "苹果", dst: "Apple", case_sensitive: false },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/u);
    expect(entries[0]?.entry_id).not.toBe("external");
  });

  it("短身份碰撞时继续生成并保留成功结果", () => {
    let call_count = 0;
    const random_spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((
      value: Uint8Array,
    ) => {
      value.fill(call_count === 0 ? 0 : 1);
      call_count += 1;
      return value;
    }) as typeof globalThis.crypto.getRandomValues);

    try {
      const entry_ids = new Set(["00000"]);
      expect(create_quality_rule_entry_id(entry_ids)).toBe("11111");
      expect(entry_ids).toEqual(new Set(["00000", "11111"]));
    } finally {
      random_spy.mockRestore();
    }
  });
});
