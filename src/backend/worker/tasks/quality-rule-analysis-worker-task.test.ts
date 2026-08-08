import { describe, expect, it } from "vitest";

import { prepare_quality_statistics_task_input } from "../../../shared/quality/quality-statistics-input";
import { run_quality_rule_analysis_worker_task } from "./quality-rule-analysis-worker-task";

describe("run_quality_rule_analysis_worker_task", () => {
  it("一次扫描返回 hits、examples 和通用关系", () => {
    const input = prepare_quality_statistics_task_input({
      rule_key: "glossary",
      entries: [
        { entry_id: "hp", src: "HP", dst: "生命值" },
        { entry_id: "max-hp", src: "Max HP", dst: "最大生命值" },
      ],
      items: [
        { src: "HP +10", name_src: "Alice" },
        { src: "Max HP", name_src: "Bob" },
      ],
    });
    const result = run_quality_rule_analysis_worker_task({ ...input, include_relations: true });

    expect(result).toEqual({
      entry_ids: ["hp", "max-hp"],
      hits_by_entry_id: { hp: 2, "max-hp": 1 },
      examples_by_entry_id: {
        hp: ["【Alice】HP +10", "【Bob】Max HP"],
        "max-hp": ["【Bob】Max HP"],
      },
      relations: {
        subset_parents_by_entry_id: { hp: ["Max HP"] },
        groups: [["hp", "max-hp"]],
      },
    });
  });

  it("缓存已有关系时可跳过关系计算", () => {
    const input = prepare_quality_statistics_task_input({
      rule_key: "text_preserve",
      entries: [{ entry_id: "tag", src: "<tag>" }],
      items: [{ src: "<tag>正文" }],
    });

    expect(
      run_quality_rule_analysis_worker_task({ ...input, include_relations: false }),
    ).not.toHaveProperty("relations");
  });
});
