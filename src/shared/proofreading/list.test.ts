import { describe, expect, it } from "vitest";

import { sort_proofreading_rows, type ProofreadingRowRecord } from "./list";

/** 构造查询使用的行引用，文件顺序由测试单独提供。 */
function create_row(
  item_id: number,
  file_path: string,
  row_number: number,
  dst: string,
): ProofreadingRowRecord {
  return {
    kind: "item",
    row_id: String(item_id),
    item: {
      item_id,
      file_path,
      internal_file_path: null,
      row_number,
      src: "",
      dst,
      name_src: null,
      name_dst: null,
      status: "NONE",
      text_type: "NONE",
      retry_count: 0,
      warnings: [],
      warning_fragments_by_code: {},
      glossary_applications: [],
    },
  };
}

describe("校对列表", () => {
  it("按指定列排序并用文件与行号稳定处理同值项", () => {
    const items = [
      create_row(1, "b.txt", 1, "A"),
      create_row(2, "a.txt", 2, "A"),
      create_row(3, "a.txt", 1, "B"),
    ];

    expect(
      sort_proofreading_rows(
        items,
        {
          column_id: "dst",
          direction: "ascending",
        },
        new Map([
          ["b.txt", 0],
          ["a.txt", 1],
        ]),
      ).map((row) => Number(row.row_id)),
    ).toEqual([1, 2, 3]);
  });
});
