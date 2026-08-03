import { describe, expect, it } from "vitest";

import type { ItemTextGroup } from "../item-text";
import { run_quality_statistics_task_sync } from "./quality-statistics";

function text_groups(groups: string[][]): ItemTextGroup[] {
  return groups.map((group) =>
    group.map((text, index) => ({ field: index === 0 ? "src" : "name_src", text })),
  );
}

describe("run_quality_statistics_task_sync", () => {
  it("按 item 去重统计字面量与正则，并统一 Unicode 字面量语义", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "strasse",
          pattern: "STRASSE",
          pattern_kind: "literal",
          case_sensitive: false,
        },
        {
          entry_id: "regex",
          pattern: "^foo\\d+$",
          pattern_kind: "regex",
          case_sensitive: false,
        },
      ],
      text_groups: text_groups([["Die Straße", "Straße"], ["foo42"], ["none"]]),
      relation_candidates: [],
    });

    expect(result.results.strasse?.matched_item_count).toBe(1);
    expect(result.results.regex?.matched_item_count).toBe(1);
  });

  it("非法正则令统计失败", () => {
    expect(() =>
      run_quality_statistics_task_sync({
        rules: [
          {
            entry_id: "broken",
            pattern: "(",
            pattern_kind: "regex",
            case_sensitive: false,
          },
        ],
        text_groups: text_groups([["foo"]]),
        relation_candidates: [],
      }),
    ).toThrow();
  });

  it("包含关系只消费显式字面量候选并保持父文本去重顺序", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "erin",
          pattern: "艾琳",
          pattern_kind: "literal",
          case_sensitive: true,
        },
        {
          entry_id: "regex",
          pattern: "艾.+",
          pattern_kind: "regex",
          case_sensitive: false,
        },
      ],
      text_groups: [],
      relation_candidates: [
        { entry_id: "erin", src: "艾琳" },
        { entry_id: "saint", src: "圣女艾琳" },
        { entry_id: "duplicate", src: "圣女艾琳" },
        { entry_id: "captain", src: "舰长艾琳" },
      ],
    });

    expect(result.results.erin?.subset_parents).toEqual(["圣女艾琳", "舰长艾琳"]);
    expect(result.results.regex?.subset_parents).toEqual([]);
  });

  it("同 item 多字段与重叠命中分别累计次数，但覆盖数只计一次", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        { entry_id: "aba", pattern: "aba", pattern_kind: "literal", case_sensitive: true },
        { entry_id: "ba", pattern: "ba", pattern_kind: "literal", case_sensitive: true },
      ],
      text_groups: text_groups([["ababa dialogue", "aba"]]),
      relation_candidates: [],
      collect_literal_evidence: true,
    });

    expect(result.results.aba?.matched_item_count).toBe(1);
    expect(result.literal_evidence_by_entry_id).toMatchObject({
      aba: {
        total_matches: 3,
        context_sample: { item_index: 0, matched_fields: ["src", "name_src"] },
      },
      ba: { total_matches: 3, context_sample: { item_index: 0 } },
    });
  });

  it("跳过只有术语或标点的命中，选择首个有字母数字语境的 item", () => {
    const result = run_quality_statistics_task_sync({
      rules: [{ entry_id: "term", pattern: "术语", pattern_kind: "literal", case_sensitive: true }],
      text_groups: text_groups([["术语"], ["术语！？"], ["对话术语", "术语"]]),
      relation_candidates: [],
      collect_literal_evidence: true,
    });

    expect(result.results.term?.matched_item_count).toBe(3);
    expect(result.literal_evidence_by_entry_id?.term).toEqual({
      total_matches: 4,
      context_sample: { item_index: 2, matched_fields: ["src", "name_src"] },
    });
  });

  it("未命中的另一 source part 可提供语境，全部无语境时 sample 为 null", () => {
    const with_context = run_quality_statistics_task_sync({
      rules: [
        { entry_id: "name", pattern: "Alice", pattern_kind: "literal", case_sensitive: true },
      ],
      text_groups: text_groups([["正文对话", "Alice"]]),
      relation_candidates: [],
      collect_literal_evidence: true,
    });
    expect(with_context.literal_evidence_by_entry_id?.name.context_sample).toEqual({
      item_index: 0,
      matched_fields: ["name_src"],
    });

    const without_context = run_quality_statistics_task_sync({
      rules: [
        { entry_id: "name", pattern: "Alice", pattern_kind: "literal", case_sensitive: false },
      ],
      text_groups: text_groups([["ALICE..."], ["Alice！"]]),
      relation_candidates: [],
      collect_literal_evidence: true,
    });
    expect(without_context.literal_evidence_by_entry_id?.name).toEqual({
      total_matches: 2,
      context_sample: null,
    });
  });

  it("默认不收集 evidence，保持原统计结果形状", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        { entry_id: "term", pattern: "term", pattern_kind: "literal", case_sensitive: false },
      ],
      text_groups: text_groups([["TERM context"]]),
      relation_candidates: [],
    });

    expect(result).not.toHaveProperty("literal_evidence_by_entry_id");
  });
});
