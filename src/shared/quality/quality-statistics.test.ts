import { describe, expect, it } from "vitest";

import type { ItemTextGroup } from "../item-text";
import {
  run_quality_statistics_task_sync,
  type QualityStatisticsTaskInput,
} from "./quality-statistics";

function text_groups(groups: string[][]): ItemTextGroup[] {
  return groups.map((group) =>
    group.map((text, index) => ({
      field: index === 0 ? "src" : "name_src",
      text,
    })),
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

  it("统计结果消费共享关系分析产生的父文本", () => {
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
        { entry_id: "erin", src: "艾琳", case_sensitive: true },
        { entry_id: "saint", src: "圣女艾琳", case_sensitive: true },
        { entry_id: "duplicate", src: "圣女艾琳", case_sensitive: true },
        { entry_id: "captain", src: "舰长艾琳", case_sensitive: true },
      ],
    });

    expect(result.results.erin?.subset_parents).toEqual(["圣女艾琳", "舰长艾琳"]);
    expect(result.results.regex?.subset_parents).toEqual([]);
  });

  it("同 item 多字段与重叠命中只计一次覆盖和一个 sample 候选", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "aba",
          pattern: "aba",
          pattern_kind: "literal",
          case_sensitive: true,
        },
        {
          entry_id: "ba",
          pattern: "ba",
          pattern_kind: "literal",
          case_sensitive: true,
        },
      ],
      text_groups: text_groups([["ababa dialogue", "aba"]]),
      relation_candidates: [],
      collect_context_samples: true,
    });

    expect(result.results.aba?.matched_item_count).toBe(1);
    expect(result.context_samples_by_entry_id).toEqual({
      aba: [{ item_index: 0 }],
      ba: [{ item_index: 0 }],
    });
  });

  it("跳过无语境命中并用一次确定性采样保留最多两个 item", () => {
    const input = {
      rules: [
        {
          entry_id: "term",
          pattern: "术语",
          pattern_kind: "literal",
          case_sensitive: true,
        },
      ],
      text_groups: text_groups([
        ["术语"],
        ["术语！？"],
        ["第一处对话术语"],
        ["第二处对话术语"],
        ["第三处对话术语"],
        ["第四处对话术语"],
      ]),
      relation_candidates: [],
      collect_context_samples: true,
    } satisfies QualityStatisticsTaskInput;
    const result = run_quality_statistics_task_sync(input);
    const repeated = run_quality_statistics_task_sync(input);

    expect(result.results.term?.matched_item_count).toBe(6);
    expect(result.context_samples_by_entry_id?.term).toHaveLength(2);
    expect(result.context_samples_by_entry_id?.term).toEqual(
      repeated.context_samples_by_entry_id?.term,
    );
    expect(
      result.context_samples_by_entry_id?.term.every(({ item_index }) => item_index >= 2),
    ).toBe(true);
  });

  it("未命中的另一 source part 可提供语境，全部无语境时 samples 为空", () => {
    const with_context = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "name",
          pattern: "Alice",
          pattern_kind: "literal",
          case_sensitive: true,
        },
      ],
      text_groups: text_groups([["正文对话", "Alice"]]),
      relation_candidates: [],
      collect_context_samples: true,
    });
    expect(with_context.context_samples_by_entry_id?.name).toEqual([{ item_index: 0 }]);

    const without_context = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "name",
          pattern: "Alice",
          pattern_kind: "literal",
          case_sensitive: false,
        },
      ],
      text_groups: text_groups([["ALICE..."], ["Alice！"]]),
      relation_candidates: [],
      collect_context_samples: true,
    });
    expect(without_context.context_samples_by_entry_id?.name).toEqual([]);
  });

  it("默认不收集 samples，保持原统计结果形状", () => {
    const result = run_quality_statistics_task_sync({
      rules: [
        {
          entry_id: "term",
          pattern: "term",
          pattern_kind: "literal",
          case_sensitive: false,
        },
      ],
      text_groups: text_groups([["TERM context"]]),
      relation_candidates: [],
    });

    expect(result).not.toHaveProperty("context_samples_by_entry_id");
  });
});
