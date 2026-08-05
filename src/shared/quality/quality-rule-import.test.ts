import { describe, expect, it } from "vitest";

import {
  collect_quality_rule_duplicate_groups,
  QualityRuleImportRuleTypeValue,
  preview_quality_rule_import,
} from "./quality-rule-import";
import type { JsonRecord } from "../../domain/json";

describe("preview_quality_rule_import", () => {
  it("无重复时直接生成相同的跳过和覆盖结果", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "艾琳", dst: "Erin", info: "角色名", case_sensitive: false }],
      incoming: [{ src: "贝尔", dst: "Belle", info: "角色名", case_sensitive: false }],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.non_duplicate_count).toBe(1);
    expect(preview.skip_entries).toEqual([
      { src: "艾琳", dst: "Erin", info: "角色名", regex: false, case_sensitive: false },
      { src: "贝尔", dst: "Belle", info: "角色名", regex: false, case_sensitive: false },
    ]);
    expect(preview.overwrite_entries).toEqual(preview.skip_entries);
  });

  it("重复时跳过旧规则并用覆盖结果改写旧目标字段", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "艾琳", dst: "Erin", info: "旧", case_sensitive: false }],
      incoming: [
        { src: "艾琳", dst: "Eileen", info: "新", case_sensitive: false },
        { src: "贝尔", dst: "Belle", info: "角色名", case_sensitive: false },
      ],
    });

    expect(preview.duplicate_count).toBe(1);
    expect(preview.non_duplicate_count).toBe(1);
    expect(preview.skipped_duplicate_count).toBe(1);
    expect(preview.duplicates).toEqual([
      {
        incoming_index: 0,
        existing_indexes: [0],
        key: JSON.stringify(["literal", false, "艾琳"]),
        kind: "different-target",
      },
    ]);
    expect(preview.skip_entries).toEqual([
      { src: "艾琳", dst: "Erin", info: "旧", regex: false, case_sensitive: false },
      { src: "贝尔", dst: "Belle", info: "角色名", regex: false, case_sensitive: false },
    ]);
    expect(preview.overwrite_entries).toEqual([
      { src: "艾琳", dst: "Eileen", info: "新", regex: false, case_sensitive: false },
      { src: "贝尔", dst: "Belle", info: "角色名", regex: false, case_sensitive: false },
    ]);
  });

  it("旧目标为空时将重复分类为 existing-target-empty", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "艾琳", dst: "", info: "", case_sensitive: false }],
      incoming: [{ src: "艾琳", dst: "Erin", info: "", case_sensitive: false }],
    });

    expect(preview.duplicates[0]?.kind).toBe("existing-target-empty");
  });

  it("新目标为空时允许覆盖结果清空旧值", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "艾琳", dst: "Erin", info: "角色名", case_sensitive: false }],
      incoming: [{ src: "艾琳", dst: "", info: "", case_sensitive: false }],
    });

    expect(preview.duplicates[0]?.kind).toBe("incoming-target-empty");
    expect(preview.overwrite_entries[0]).toEqual({
      src: "艾琳",
      dst: "",
      info: "",
      regex: false,
      case_sensitive: false,
    });
  });

  it("大小写策略不同的字面量保持独立身份", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
      existing: [{ src: "Name", dst: "A", regex: false, case_sensitive: true }],
      incoming: [
        { src: "name", dst: "B", regex: false, case_sensitive: true },
        { src: "NAME", dst: "C", regex: false, case_sensitive: false },
      ],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.overwrite_entries).toHaveLength(3);
  });

  it("全部大小写敏感时允许同 fold 下不同 src 并存", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "生命值", case_sensitive: true }],
      incoming: [{ src: "hp", dst: "hp", case_sensitive: true }],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.overwrite_entries.map((entry) => entry.src)).toEqual(["HP", "hp"]);
  });

  it("相同 case flag 的半角与全角字面量按执行身份判重", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "JK", dst: "旧", case_sensitive: true }],
      incoming: [{ src: "ＪＫ", dst: "新", case_sensitive: true }],
    });

    expect(preview.duplicate_count).toBe(1);
    expect(preview.overwrite_entries).toHaveLength(1);
    expect(preview.overwrite_entries[0]?.dst).toBe("新");
  });

  it("大小写敏感与不敏感规则不互相覆盖", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "生命值", case_sensitive: true }],
      incoming: [{ src: "hp", dst: "血量", case_sensitive: false }],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.overwrite_entries).toHaveLength(2);
  });

  it("文本替换的 pattern kind 与大小写标志参与身份", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
      existing: [{ src: "foo", dst: "bar", regex: false, case_sensitive: false }],
      incoming: [{ src: "foo", dst: "baz", regex: true, case_sensitive: true }],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.overwrite_entries).toHaveLength(2);
  });

  it("相同正则源码的不同大小写策略不判重", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
      existing: [{ src: "foo", dst: "A", regex: true, case_sensitive: false }],
      incoming: [{ src: "foo", dst: "B", regex: true, case_sensitive: true }],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.overwrite_entries).toHaveLength(2);
  });

  it("文本保护按原始正则源码判重", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
      existing: [{ src: "{name}", info: "旧说明" }],
      incoming: [{ src: "{NAME}", info: "新说明" }],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.skip_entries[0]).toEqual({
      src: "{name}",
      dst: "",
      info: "旧说明",
      regex: false,
      case_sensitive: false,
    });
    expect(preview.overwrite_entries[1]).toEqual({
      src: "{NAME}",
      dst: "",
      info: "新说明",
      regex: false,
      case_sensitive: false,
    });
  });

  it("会丢弃空 src 和非对象条目", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [{ src: "   ", dst: "X" }],
      incoming: [
        "bad",
        { src: null, dst: "Y" },
        { src: "A", dst: "甲" },
      ] as unknown as JsonRecord[],
    });

    expect(preview.duplicate_count).toBe(0);
    expect(preview.overwrite_entries).toEqual([
      {
        src: "A",
        dst: "甲",
        info: "",
        regex: false,
        case_sensitive: false,
      },
    ]);
  });

  it("已有同源规则在预览结果中保留最后一条目标字段", () => {
    const preview = preview_quality_rule_import({
      rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
      existing: [
        { src: "HP", dst: "旧值", info: "old", case_sensitive: true },
        { src: "HP", dst: "新值", info: "new", case_sensitive: true },
      ],
      incoming: [],
    });

    expect(preview.overwrite_entries).toHaveLength(1);
    expect(preview.overwrite_entries[0]?.dst).toBe("新值");
  });
});

describe("collect_quality_rule_duplicate_groups", () => {
  it("只返回现有规则内部执行身份完全相同的重复组", () => {
    expect(
      collect_quality_rule_duplicate_groups({
        rule_type: QualityRuleImportRuleTypeValue.GLOSSARY,
        entries: [
          { src: "Alpha", dst: "A", case_sensitive: false },
          { src: "ＡＬＰＨＡ", dst: "B", case_sensitive: false },
          { src: "Beta", dst: "C", case_sensitive: false },
        ],
      }),
    ).toEqual([{ key: JSON.stringify(["literal", false, "alpha"]), indexes: [0, 1] }]);
  });
});
