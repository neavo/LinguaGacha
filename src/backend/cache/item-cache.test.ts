import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import { ItemCache } from "./item-cache";

describe("ItemCache", () => {
  it("按 item id 和插入顺序维护克隆后的条目索引", () => {
    const cache = new ItemCache();

    cache.replace([
      create_item(1, { file_path: "a.txt", src: "A" }),
      create_item(2, { file_path: "b.txt", src: "B" }),
    ]);
    const first = cache.readItems()[0];
    if (first !== undefined) {
      first["src"] = "changed";
    }

    expect(cache.size()).toBe(2);
    expect(cache.readItem(1)).toMatchObject({ item_id: 1, file_path: "a.txt", src: "A" });
    expect(cache.readItems().map((item) => item["item_id"])).toEqual([1, 2]);
  });

  it("应用 item 增量时维护 upsert、delete、字段补丁和稳定顺序", () => {
    const cache = new ItemCache();
    cache.replace([
      create_item(1, { file_path: "a.txt", src: "A" }),
      create_item(2, { file_path: "a.txt", src: "B" }),
      create_item(3, { file_path: "b.txt", src: "C" }),
    ]);

    cache.applyChange(
      {
        mode: "delta",
        changedIds: [1],
        deleteIds: [2],
        fieldPatch: { dst: "译文 A", status: "PROCESSED" },
        sourcePayloadMode: "field-patch",
      },
      [],
    );
    cache.applyChange(
      {
        mode: "delta",
        changedIds: [3, 4],
        deleteIds: [],
        fieldPatch: null,
        sourcePayloadMode: "canonical-delta",
      },
      [
        create_item(3, { file_path: "c.txt", src: "C", dst: "译文 C" }),
        create_item(4, { file_path: "c.txt", src: "D", dst: "译文 D" }),
      ],
    );

    expect(cache.readItems().map((item) => item["item_id"])).toEqual([1, 3, 4]);
    expect(cache.readItem(1)).toMatchObject({
      item_id: 1,
      file_path: "a.txt",
      src: "A",
      dst: "译文 A",
      status: "PROCESSED",
    });
  });
});

function create_item(
  item_id: number,
  overrides: Partial<ProjectItemPublicRecord> = {},
): ProjectItemPublicRecord {
  return {
    item_id,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: item_id,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}
