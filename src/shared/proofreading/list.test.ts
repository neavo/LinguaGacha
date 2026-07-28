import { describe, expect, it } from "vitest";

import { create_proofreading_client_item, sort_proofreading_client_items } from "./list";

function create_item(item_id: number, file_path: string, row_number: number, dst: string) {
  return create_proofreading_client_item({
    item: {
      item_id,
      file_path,
      row_number,
      src: "",
      dst,
      name_src: null,
      name_dst: null,
      status: "NONE",
      retry_count: 0,
    },
    warnings: [],
    warning_fragments_by_code: {},
    failed_terms: [],
    applied_terms: [],
  });
}

describe("proofreading list", () => {
  it("按指定列排序并用文件与行号稳定处理同值项", () => {
    const items = [
      create_item(1, "b.txt", 1, "A"),
      create_item(2, "a.txt", 2, "A"),
      create_item(3, "a.txt", 1, "B"),
    ];

    expect(
      sort_proofreading_client_items(items, {
        column_id: "dst",
        direction: "ascending",
      }).map((item) => item.item_id),
    ).toEqual([2, 1, 3]);
  });
});
