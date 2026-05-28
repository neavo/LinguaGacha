import { describe, expect, it } from "vitest";

import {
  build_proofreading_visible_items,
  compare_proofreading_runtime_items,
  create_proofreading_client_item,
  sort_proofreading_client_items,
} from "@/pages/proofreading-page/proofreading-list-runtime";
import type {
  ProofreadingClientItem,
  ProofreadingGlossaryTerm,
} from "@/pages/proofreading-page/types";

// create_client_item 构造排序测试所需的轻量校对行，默认字段体现自然顺序。
function create_client_item(overrides: Partial<ProofreadingClientItem>): ProofreadingClientItem {
  return {
    item_id: 1,
    file_path: "chapter-a.txt",
    row_number: 1,
    src: "src",
    dst: "dst",
    status: "NONE",
    retry_count: 0,
    warnings: [],
    warning_fragments_by_code: {},
    applied_glossary_terms: [],
    failed_glossary_terms: [],
    row_id: "1",
    compressed_src: "src",
    compressed_dst: "dst",
    ...overrides,
  };
}

describe("proofreading-list-runtime", () => {
  it("构建 client item 时克隆质量派生数组并生成渲染字段", () => {
    const warnings = ["GLOSSARY"];
    const fragments = { KANA: ["かな"] };
    const failed_terms: ProofreadingGlossaryTerm[] = [["魔法", "Magic"]];
    const applied_terms: ProofreadingGlossaryTerm[] = [["少女", "Girl"]];

    const item = create_proofreading_client_item({
      item: {
        item_id: 42,
        file_path: "chapter.txt",
        row_number: 7,
        src: "很长很长的源文",
        dst: "很长很长的译文",
        status: "NONE",
        retry_count: 0,
      },
      warnings,
      warning_fragments_by_code: fragments,
      failed_terms,
      applied_terms,
    });
    warnings.push("KANA");
    fragments.KANA.push("カナ");
    failed_terms[0] = ["魔女", "Witch"];
    applied_terms[0] = ["少年", "Boy"];

    expect(item).toMatchObject({
      item_id: 42,
      row_id: "42",
      warnings: ["GLOSSARY"],
      warning_fragments_by_code: { KANA: ["かな"] },
      failed_glossary_terms: [["魔法", "Magic"]],
      applied_glossary_terms: [["少女", "Girl"]],
    });
    expect(item.compressed_src).toBe("很长很长的源文");
    expect(item.compressed_dst).toBe("很长很长的译文");
  });

  it("列表排序按目标列排序并用自然顺序稳定兜底", () => {
    const items = [
      create_client_item({
        item_id: 3,
        row_id: "3",
        file_path: "chapter-b.txt",
        row_number: 2,
        src: "同文",
        status: "ERROR",
      }),
      create_client_item({
        item_id: 1,
        row_id: "1",
        file_path: "chapter-a.txt",
        row_number: 1,
        src: "同文",
        status: "NONE",
      }),
      create_client_item({
        item_id: 2,
        row_id: "2",
        file_path: "chapter-a.txt",
        row_number: 2,
        src: "同文",
        status: "PROCESSED",
      }),
    ];

    expect(
      sort_proofreading_client_items([...items], {
        column_id: "src",
        direction: "ascending",
      }).map((item) => item.row_id),
    ).toEqual(["1", "2", "3"]);
    expect(
      sort_proofreading_client_items([...items], {
        column_id: "status",
        direction: "ascending",
      }).map((item) => item.row_id),
    ).toEqual(["1", "2", "3"]);
  });

  it("运行时自然顺序和可见窗口行保持稳定 row id", () => {
    const ordered = [
      {
        item_id: 2,
        file_path: "chapter-a.txt",
        row_number: 2,
        src: "",
        dst: "",
        status: "NONE",
        retry_count: 0,
      },
      {
        item_id: 1,
        file_path: "chapter-a.txt",
        row_number: 1,
        src: "",
        dst: "",
        status: "NONE",
        retry_count: 0,
      },
    ].sort(compare_proofreading_runtime_items);
    const visible_items = build_proofreading_visible_items([
      create_client_item({ item_id: 1, row_id: "1", compressed_src: "s", compressed_dst: "d" }),
    ]);

    expect(ordered.map((item) => item.item_id)).toEqual([1, 2]);
    expect(visible_items).toEqual([
      {
        row_id: "1",
        item: expect.objectContaining({ item_id: 1 }),
        compressed_src: "s",
        compressed_dst: "d",
      },
    ]);
  });
});
