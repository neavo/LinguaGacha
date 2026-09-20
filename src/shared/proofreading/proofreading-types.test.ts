import { describe, expect, it } from "vitest";

import {
  type ProofreadingFilterOptions,
  build_proofreading_warning_summary,
  clone_proofreading_filter_options,
  resolve_proofreading_outcomes,
  resolve_proofreading_status_sort_rank,
} from "./proofreading-types";

describe("proofreading types", () => {
  it("未知状态排在已知状态之后", () => {
    expect(resolve_proofreading_status_sort_rank("NONE")).toBeLessThan(
      resolve_proofreading_status_sort_rank("UNKNOWN"),
    );
  });

  it("克隆筛选项时不会共享术语 ID 数组", () => {
    const filters: ProofreadingFilterOptions = {
      outcomes: ["GLOSSARY", "NONE", "PROCESSED", "ERROR"],
      files: { mode: "selected", values: [{ file_path: "chapter.txt", internal_file_path: null }] },
      glossary_entry_ids: ["magic"],
      include_without_glossary_miss: true,
    };
    const cloned = clone_proofreading_filter_options(filters);
    cloned.outcomes.push("FOREIGN_CHAR_RESIDUE");
    cloned.glossary_entry_ids[0] = "dirty";

    expect(filters.outcomes).toEqual(["GLOSSARY", "NONE", "PROCESSED", "ERROR"]);
    expect(filters.glossary_entry_ids).toEqual(["magic"]);
  });

  it("将成功条目按警告投影，其他状态保持单一结果", () => {
    expect(resolve_proofreading_outcomes({ status: "PROCESSED", warnings: [] })).toEqual([
      "NO_WARNING",
    ]);
    expect(
      resolve_proofreading_outcomes({
        status: "PROCESSED",
        warnings: ["FOREIGN_CHAR_RESIDUE", "GLOSSARY"],
      }),
    ).toEqual(["FOREIGN_CHAR_RESIDUE", "GLOSSARY"]);
    expect(resolve_proofreading_outcomes({ status: "ERROR", warnings: [] })).toEqual(["ERROR"]);
  });

  it("按固定类型顺序汇总成功译文的校对警告", () => {
    expect(
      build_proofreading_warning_summary([
        { status: "PROCESSED", warnings: ["GLOSSARY", "FOREIGN_CHAR_RESIDUE"] },
        { status: "PROCESSED", warnings: ["GLOSSARY", "GLOSSARY"] },
        { status: "ERROR", warnings: ["TEXT_PRESERVE"] },
      ]),
    ).toEqual({
      total_count: 3,
      entries: [
        { code: "FOREIGN_CHAR_RESIDUE", count: 1 },
        { code: "GLOSSARY", count: 2 },
      ],
    });
  });
});
