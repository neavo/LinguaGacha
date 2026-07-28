import { describe, expect, it } from "vitest";

import {
  clone_proofreading_filter_options,
  compress_proofreading_text,
  format_proofreading_glossary_term,
  resolve_default_proofreading_warning_types,
  resolve_proofreading_status_sort_rank,
} from "./proofreading-types";

describe("proofreading types", () => {
  it("格式化术语、压缩换行并将未知状态排在已知状态之后", () => {
    expect(format_proofreading_glossary_term(["魔法", "Magic"])).toBe("魔法 -> Magic");
    expect(compress_proofreading_text("第一行\n第二行")).toBe("第一行 ↵ 第二行");
    expect(resolve_proofreading_status_sort_rank("NONE")).toBeLessThan(
      resolve_proofreading_status_sort_rank("UNKNOWN"),
    );
  });

  it("克隆筛选项时不会共享术语元组", () => {
    const filters = {
      warning_types: ["GLOSSARY"],
      statuses: ["NONE", "PROCESSED", "ERROR"],
      file_paths: ["chapter.txt"],
      glossary_terms: [["魔法", "Magic"] as const],
      include_without_glossary_miss: true,
    };
    const cloned = clone_proofreading_filter_options(filters);
    cloned.glossary_terms[0] = ["污染", "Dirty"];

    expect(filters.warning_types).toEqual(["GLOSSARY"]);
    expect(filters.glossary_terms).toEqual([["魔法", "Magic"]]);
  });

  it("默认警告筛选保留已知顺序并追加去重的未知警告", () => {
    expect(
      resolve_default_proofreading_warning_types(["CUSTOM_B", "GLOSSARY", "CUSTOM_A", "CUSTOM_B"]),
    ).toEqual([
      "NO_WARNING",
      "KANA",
      "HANGEUL",
      "TEXT_PRESERVE",
      "SIMILARITY",
      "GLOSSARY",
      "RETRY_THRESHOLD",
      "CUSTOM_A",
      "CUSTOM_B",
    ]);
  });
});
