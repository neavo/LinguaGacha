import { describe, expect, it } from "vitest";

import {
  clone_proofreading_filter_options,
  compress_proofreading_text,
  create_empty_proofreading_filter_panel_state,
  create_empty_proofreading_list_view,
  format_proofreading_glossary_term,
  PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES,
  resolve_default_proofreading_warning_types,
  resolve_proofreading_status_sort_rank,
} from "./proofreading-types";

describe("proofreading types", () => {
  it("提供校对列表的稳定展示和排序工具", () => {
    expect(format_proofreading_glossary_term(["魔法", "Magic"])).toBe("魔法 -> Magic");
    expect(compress_proofreading_text("第一行\n第二行")).toBe("第一行 ↵ 第二行");
    expect(resolve_proofreading_status_sort_rank("NONE")).toBeLessThan(
      resolve_proofreading_status_sort_rank("UNKNOWN"),
    );
  });

  it("克隆筛选项时不会共享术语元组", () => {
    const filters = {
      warning_types: ["GLOSSARY"],
      statuses: [...PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES],
      file_paths: ["chapter.txt"],
      glossary_terms: [["魔法", "Magic"] as const],
      include_without_glossary_miss: true,
    };
    const cloned = clone_proofreading_filter_options(filters);
    cloned.glossary_terms[0] = ["污染", "Dirty"];

    expect(filters.warning_types).toEqual(["GLOSSARY"]);
    expect(filters.glossary_terms).toEqual([["魔法", "Magic"]]);
  });

  it("生成默认筛选和空状态时保持固定字段形状", () => {
    expect(PROOFREADING_DEFAULT_ACTIVE_STATUS_CODES).toEqual(["NONE", "PROCESSED", "ERROR"]);
    expect(resolve_default_proofreading_warning_types(["CUSTOM", "GLOSSARY"])).toContain("CUSTOM");
    expect(create_empty_proofreading_list_view()).toMatchObject({
      row_count: 0,
      window_rows: [],
      invalid_regex_message: null,
    });
    expect(create_empty_proofreading_filter_panel_state().warning_count_by_code).toEqual({
      NO_WARNING: 0,
    });
  });
});
