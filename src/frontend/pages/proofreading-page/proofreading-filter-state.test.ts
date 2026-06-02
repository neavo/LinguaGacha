import { describe, expect, it } from "vitest";

import {
  materialize_proofreading_filters,
  resolve_proofreading_filter_selection_from_filters,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import type {
  ProofreadingFilterOptions,
  ProofreadingGlossaryTerm,
} from "@shared/proofreading/proofreading-types";

// 生成当前测试场景的完整筛选载荷，避免用例只关心术语时遗漏其它维度语义。
function create_filters(patch: Partial<ProofreadingFilterOptions> = {}): ProofreadingFilterOptions {
  return {
    warning_types: ["NO_WARNING", "GLOSSARY"],
    statuses: ["NONE", "PROCESSED", "ERROR"],
    file_paths: ["chapter01.txt"],
    glossary_terms: [],
    include_without_glossary_miss: true,
    ...patch,
  };
}

describe("resolve_proofreading_filter_selection_from_filters", () => {
  // 默认术语筛选确认后仍保存默认意图，后续新增术语应随默认值展开。
  it("未改动的默认术语筛选会继续跟随后续默认术语", () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
    const next_glossary_term: ProofreadingGlossaryTerm = ["王国", "Kingdom"];
    const default_filters = create_filters({
      glossary_terms: [glossary_term],
    });

    const selection = resolve_proofreading_filter_selection_from_filters({
      filters: create_filters({
        glossary_terms: [["魔法", "Magic"]],
      }),
      default_filters,
    });

    expect(selection.glossary_terms).toEqual({ mode: "default" });
    expect(
      materialize_proofreading_filters(
        selection,
        create_filters({
          glossary_terms: [glossary_term, next_glossary_term],
        }),
      ).glossary_terms,
    ).toEqual([glossary_term, next_glossary_term]);
  });

  // 空术语列表代表用户明确排除术语缺失项，后续默认值变化不能覆盖该选择。
  it("显式清空术语筛选后会保留空选择", () => {
    const glossary_term: ProofreadingGlossaryTerm = ["魔法", "Magic"];
    const next_glossary_term: ProofreadingGlossaryTerm = ["王国", "Kingdom"];

    const selection = resolve_proofreading_filter_selection_from_filters({
      filters: create_filters({
        glossary_terms: [],
      }),
      default_filters: create_filters({
        glossary_terms: [glossary_term],
      }),
    });

    expect(selection.glossary_terms).toEqual({ mode: "selected", values: [] });
    expect(
      materialize_proofreading_filters(
        selection,
        create_filters({
          glossary_terms: [glossary_term, next_glossary_term],
        }),
      ).glossary_terms,
    ).toEqual([]);
  });

  // 普通筛选维度按集合比较，面板展示顺序变化不能改变用户意图。
  it("默认筛选值顺序变化不会固化普通筛选维度", () => {
    const selection = resolve_proofreading_filter_selection_from_filters({
      filters: create_filters({
        statuses: ["ERROR", "NONE", "PROCESSED"],
      }),
      default_filters: create_filters({
        statuses: ["NONE", "PROCESSED", "ERROR"],
      }),
    });

    expect(selection.statuses).toEqual({ mode: "default" });
  });
});
