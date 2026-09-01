import { describe, expect, it } from "vitest";

import {
  build_proofreading_warning_summary,
  clone_proofreading_filter_options,
  compress_proofreading_text,
  format_proofreading_glossary_term,
  resolve_proofreading_outcomes,
  resolve_proofreading_status_sort_rank,
} from "./proofreading-types";

describe("proofreading types", () => {
  it("格式化术语、压缩换行并将未知状态排在已知状态之后", () => {
    expect(format_proofreading_glossary_term({ src: "魔法", dst: "Magic" })).toBe("魔法 -> Magic");
    expect(compress_proofreading_text("第一行\n第二行")).toBe("第一行 ↵ 第二行");
    expect(resolve_proofreading_status_sort_rank("NONE")).toBeLessThan(
      resolve_proofreading_status_sort_rank("UNKNOWN"),
    );
  });

  it("克隆筛选项时不会共享术语 ID 数组", () => {
    const filters = {
      outcomes: ["GLOSSARY", "NONE", "PROCESSED", "ERROR"],
      file_paths: ["chapter.txt"],
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
