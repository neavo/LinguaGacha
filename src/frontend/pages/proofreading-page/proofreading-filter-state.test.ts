import { describe, expect, it } from "vitest";

import {
  build_filter_signature,
  create_default_proofreading_filter_selection,
  materialize_proofreading_filters,
  resolve_proofreading_filter_selection_from_filters,
} from "@frontend/pages/proofreading-page/proofreading-filter-state";
import type { ProofreadingFilterOptions } from "@shared/proofreading/proofreading-types";

// 生成当前测试场景的完整筛选载荷，避免用例只关心术语时遗漏其它维度语义。
function create_filters(patch: Partial<ProofreadingFilterOptions> = {}): ProofreadingFilterOptions {
  return {
    outcomes: ["NO_WARNING", "GLOSSARY", "NONE", "PROCESSED", "ERROR"],
    files: { mode: "selected", values: [{ file_path: "chapter01.txt", internal_file_path: null }] },
    glossary_entry_ids: [],
    include_without_glossary_miss: true,
    ...patch,
  };
}

describe("resolve_proofreading_filter_selection_from_filters", () => {
  // 默认术语筛选确认后仍保存默认意图，后续新增术语应随默认值展开。
  it("未改动的默认术语筛选会继续跟随后续默认术语", () => {
    const glossary_entry_id = "magic";
    const next_glossary_entry_id = "kingdom";
    const default_filters = create_filters({
      glossary_entry_ids: [glossary_entry_id],
    });

    const selection = resolve_proofreading_filter_selection_from_filters({
      file_selection: { mode: "default" },
      filters: create_filters({
        glossary_entry_ids: ["magic"],
      }),
      default_filters,
    });

    expect(selection.glossary_entry_ids).toEqual({ mode: "default" });
    expect(
      materialize_proofreading_filters(
        selection,
        create_filters({
          glossary_entry_ids: [glossary_entry_id, next_glossary_entry_id],
        }),
      ).glossary_entry_ids,
    ).toEqual([glossary_entry_id, next_glossary_entry_id]);
  });

  // 空术语列表代表用户明确排除术语缺失项，后续默认值变化不能覆盖该选择。
  it("显式清空术语筛选后会保留空选择", () => {
    const glossary_entry_id = "magic";
    const next_glossary_entry_id = "kingdom";

    const selection = resolve_proofreading_filter_selection_from_filters({
      file_selection: { mode: "default" },
      filters: create_filters({
        glossary_entry_ids: [],
      }),
      default_filters: create_filters({
        glossary_entry_ids: [glossary_entry_id],
      }),
    });

    expect(selection.glossary_entry_ids).toEqual({ mode: "selected", values: [] });
    expect(
      materialize_proofreading_filters(
        selection,
        create_filters({
          glossary_entry_ids: [glossary_entry_id, next_glossary_entry_id],
        }),
      ).glossary_entry_ids,
    ).toEqual([]);
  });

  // 普通筛选维度按集合比较，面板展示顺序变化不能改变用户意图。
  it("默认筛选值顺序变化不会固化普通筛选维度", () => {
    const selection = resolve_proofreading_filter_selection_from_filters({
      file_selection: { mode: "default" },
      filters: create_filters({
        outcomes: ["ERROR", "NONE", "PROCESSED"],
      }),
      default_filters: create_filters({
        outcomes: ["NONE", "PROCESSED", "ERROR"],
      }),
    });

    expect(selection.outcomes).toEqual({ mode: "default" });
  });
});

it("默认文件范围保持紧凑，查询签名按完整内部身份和集合语义比较", () => {
  const defaults = create_filters();
  expect(
    materialize_proofreading_filters(
      create_default_proofreading_filter_selection(defaults),
      defaults,
    ).files,
  ).toEqual({ mode: "default" });
  const first = { file_path: "book.epub", internal_file_path: "Text/01.xhtml" };
  const second = { file_path: "book.epub", internal_file_path: "Text/02.xhtml" };
  const signature = (values: (typeof first)[]) =>
    build_filter_signature(create_filters({ files: { mode: "selected", values } }));
  expect(signature([first, second])).toBe(signature([second, first]));
  expect(signature([first])).not.toBe(signature([second]));
  expect(signature([])).not.toBe(
    build_filter_signature(create_filters({ files: { mode: "default" } })),
  );
});
