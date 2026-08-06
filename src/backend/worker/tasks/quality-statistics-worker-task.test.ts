import { describe, expect, it } from "vitest";

import { prepare_quality_statistics_task_input } from "../../../shared/quality/quality-statistics-input";
import { run_quality_statistics_worker_task } from "./quality-statistics-worker-task";

describe("run_quality_statistics_worker_task", () => {
  it("执行准备后的质量统计输入并返回匹配计数快照", () => {
    const result = run_quality_statistics_worker_task(
      prepare_quality_statistics_task_input({
        rule_key: "glossary",
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
        items: [
          { src: "HP +10", dst: "生命值 +10" },
          { src: "MP +5", dst: "魔力 +5" },
        ],
      }),
    );

    expect(result).toMatchObject({
      phase: "current",
      completed_entry_ids: ["hp"],
      matched_count_by_entry_id: { hp: 1 },
      last_error: null,
    });
    expect(result).not.toHaveProperty("context_samples_by_entry_id");
  });

  it("只在显式开启时返回最多两个 context samples", () => {
    const result = run_quality_statistics_worker_task(
      prepare_quality_statistics_task_input({
        rule_key: "glossary",
        entries: [{ entry_id: "hp", src: "HP", dst: "生命值" }],
        items: [{ src: "HP +10", name_src: "HP" }, { src: "HP -5" }, { src: "HP +20" }],
        collect_context_samples: true,
      }),
    );

    expect(result).toMatchObject({
      context_samples_by_entry_id: {
        hp: [{ item_index: expect.any(Number) }, { item_index: expect.any(Number) }],
      },
    });
  });
});
