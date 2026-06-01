import { describe, expect, it } from "vitest";

import { ItemCache } from "./item-cache";

describe("ItemCache", () => {
  it("按 item id 和文件路径维护克隆后的条目索引", () => {
    const cache = new ItemCache();

    cache.replace([
      { item_id: 1, file_path: "a.txt", src: "A" },
      { item_id: 2, file_path: "b.txt", src: "B" },
      { item_id: 0, file_path: "bad.txt", src: "bad" },
    ]);
    const first = cache.readItems({ filePath: "a.txt" })[0];
    if (first !== undefined) {
      first["src"] = "changed";
    }

    expect(cache.size()).toBe(2);
    expect(cache.readItem(1)).toEqual({ item_id: 1, file_path: "a.txt", src: "A" });
    expect(cache.readItems().map((item) => item["item_id"])).toEqual([1, 2]);
    expect(cache.readItems({ filePath: "a.txt" })).toEqual([
      { item_id: 1, file_path: "a.txt", src: "A" },
    ]);
  });

  it("应用 item 增量时维护 upsert、delete、字段补丁和文件索引", () => {
    const cache = new ItemCache();
    cache.replace([
      { item_id: 1, file_path: "a.txt", src: "A", dst: "" },
      { item_id: 2, file_path: "a.txt", src: "B", dst: "" },
      { item_id: 3, file_path: "b.txt", src: "C", dst: "" },
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
        { item_id: 3, file_path: "c.txt", src: "C", dst: "译文 C" },
        { item_id: 4, file_path: "c.txt", src: "D", dst: "译文 D" },
      ],
    );

    expect(cache.readItems().map((item) => item["item_id"])).toEqual([1, 3, 4]);
    expect(cache.readItem(1)).toEqual({
      item_id: 1,
      file_path: "a.txt",
      src: "A",
      dst: "译文 A",
      status: "PROCESSED",
    });
    expect(cache.readItems({ filePath: "a.txt" }).map((item) => item["item_id"])).toEqual([1]);
    expect(cache.readItems({ filePath: "b.txt" })).toEqual([]);
    expect(cache.readItems({ filePath: "c.txt" }).map((item) => item["item_id"])).toEqual([3, 4]);
  });

  it("更新同文件已有 item 时保持文件内读取顺序", () => {
    const cache = new ItemCache();
    cache.replace([
      { item_id: 1, file_path: "a.txt", src: "A", dst: "" },
      { item_id: 2, file_path: "a.txt", src: "B", dst: "" },
      { item_id: 3, file_path: "a.txt", src: "C", dst: "" },
    ]);

    cache.applyChange(
      {
        mode: "delta",
        changedIds: [2],
        deleteIds: [],
        fieldPatch: { dst: "译文 B" },
        sourcePayloadMode: "field-patch",
      },
      [],
    );
    cache.applyChange(
      {
        mode: "delta",
        changedIds: [2],
        deleteIds: [],
        fieldPatch: null,
        sourcePayloadMode: "canonical-delta",
      },
      [{ item_id: 2, file_path: "a.txt", src: "B", dst: "译文 B2" }],
    );

    expect(cache.readItems({ filePath: "a.txt" }).map((item) => item["item_id"])).toEqual([
      1, 2, 3,
    ]);
  });
});
