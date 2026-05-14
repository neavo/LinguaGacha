import { describe, expect, it } from "vitest";

import {
  QualityRuleMergeModeValue,
  QualityRuleMergeRuleTypeValue,
  merge_quality_rule_entries,
  preview_quality_rule_merge,
} from "./merger";
import type { JsonRecord } from "../utils/json-tool";

describe("quality rule merger", () => {
  it("glossary overwrite 会更新已有条目且不改变顺序", () => {
    const existing = [
      {
        src: "HP",
        dst: "旧值",
        info: "old",
        case_sensitive: false,
      },
      {
        src: "MP",
        dst: "魔力",
        info: "",
        case_sensitive: false,
      },
    ];
    const incoming = [{ src: "  HP  ", dst: "生命值", info: "new" }];

    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing,
      incoming,
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged.map((entry) => entry.src)).toEqual(["HP", "MP"]);
    expect(merged[0].dst).toBe("生命值");
    expect(merged[0].info).toBe("new");
    expect(report.updated).toBeGreaterThan(0);
  });

  it("glossary 全部大小写敏感时允许同 fold 下不同 src 并存", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "生命值", case_sensitive: true }],
      incoming: [{ src: "hp", dst: "hp", case_sensitive: true }],
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged.map((entry) => entry.src)).toEqual(["HP", "hp"]);
    expect(report.deduped).toBe(0);
  });

  it("glossary 混合大小写敏感时折叠为单条", () => {
    const { merged } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "生命值", case_sensitive: true }],
      incoming: [{ src: "hp", dst: "血量", case_sensitive: false }],
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged).toHaveLength(1);
    expect(String(merged[0].src).toLowerCase()).toBe("hp");
    expect(merged[0].dst).toBe("血量");
    expect(merged[0].case_sensitive).toBe(false);
  });

  it("replacement 判重 key 不包含 regex", () => {
    const { merged } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.PRE_REPLACEMENT,
      existing: [{ src: "ABC", dst: "1", regex: false, case_sensitive: false }],
      incoming: [{ src: "abc", dst: "2", regex: true, case_sensitive: false }],
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].dst).toBe("2");
    expect(merged[0].regex).toBe(true);
  });

  it("text preserve 按 fold 去重", () => {
    const { merged } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.TEXT_PRESERVE,
      existing: [{ src: "foo", info: "old" }],
      incoming: [{ src: "FOO", info: "new" }],
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged).toHaveLength(1);
    expect(String(merged[0].src).toLowerCase()).toBe("foo");
    expect(merged[0].info).toBe("new");
  });

  it("会丢弃空 src 条目", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [{ src: "   ", dst: "X" }],
      incoming: [
        { src: null, dst: "Y" },
        { src: "A", dst: "甲" },
      ] as JsonRecord[],
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged).toEqual([
      {
        src: "A",
        dst: "甲",
        info: "",
        regex: false,
        case_sensitive: false,
      },
    ]);
    expect(report.skipped_empty_src).toBe(2);
  });

  it("fill empty 不覆盖非空字段或 case_sensitive", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "生命值", info: "", case_sensitive: true }],
      incoming: [{ src: "hp", dst: "血量", info: "new", case_sensitive: false }],
      merge_mode: QualityRuleMergeModeValue.FILL_EMPTY,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].dst).toBe("生命值");
    expect(merged[0].case_sensitive).toBe(true);
    expect(report.filled).toBe(1);
  });

  it("merge mode 缺失时默认 overwrite", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "旧值", info: "old" }],
      incoming: [{ src: "hp", dst: "新值", info: "new" }],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].dst).toBe("新值");
    expect(report.updated).toBe(1);
  });

  it("跳过输入中的非对象条目", () => {
    const incoming = ["bad", { src: "MP", dst: "魔力" }] as unknown as JsonRecord[];

    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [{ src: "HP", dst: "生命值" }],
      incoming,
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged.map((entry) => entry.src)).toEqual(["HP", "MP"]);
    expect(report.added).toBe(1);
  });

  it("text preserve fill empty 只填 info", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.TEXT_PRESERVE,
      existing: [{ src: "Tag", info: "" }],
      incoming: [{ src: "TAG", info: "保留标签" }],
      merge_mode: QualityRuleMergeModeValue.FILL_EMPTY,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].info).toBe("保留标签");
    expect(report.filled).toBe(1);
    expect(report.updated).toBe(0);
  });

  it("pre replacement fill empty 会按相同 src_norm 去重", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.PRE_REPLACEMENT,
      existing: [
        { src: "HP", dst: "", regex: true, case_sensitive: true },
        { src: "HP", dst: "旧值", regex: false, case_sensitive: true },
      ],
      incoming: [{ src: "HP", dst: "新值", regex: false, case_sensitive: true }],
      merge_mode: QualityRuleMergeModeValue.FILL_EMPTY,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].src).toBe("HP");
    expect(merged[0].dst).toBe("旧值");
    expect(merged[0].regex).toBe(true);
    expect(report.deduped).toBe(2);
    expect(report.filled).toBe(1);
  });

  it("overwrite 会更新同 src_norm 分组中的后续条目", () => {
    const { merged, report } = merge_quality_rule_entries({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [
        { src: "HP", dst: "旧值", info: "old", case_sensitive: true },
        { src: "HP", dst: "新值", info: "new", case_sensitive: true },
      ],
      incoming: [],
      merge_mode: QualityRuleMergeModeValue.OVERWRITE,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].dst).toBe("新值");
    expect(report.updated).toBe(1);
    expect(report.deduped).toBe(1);
  });

  it("preview merge 会收集折叠后新条目的 incoming 下标", () => {
    const preview = preview_quality_rule_merge({
      rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
      existing: [],
      incoming: [
        { src: "Alice", dst: "爱丽丝", info: "", case_sensitive: false },
        { src: " alice ", dst: "", info: "女性人名", case_sensitive: false },
      ],
      merge_mode: QualityRuleMergeModeValue.FILL_EMPTY,
    });

    expect(preview.merged).toHaveLength(1);
    expect(preview.merged[0].src).toBe("Alice");
    expect(preview.merged[0].dst).toBe("爱丽丝");
    expect(preview.merged[0].info).toBe("女性人名");
    expect(preview.report.deduped).toBe(1);
    expect(preview.report.filled).toBe(1);
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].is_new).toBe(true);
    expect(preview.entries[0].incoming_indexes).toEqual([0, 1]);
  });
});
