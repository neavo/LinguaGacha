import { plan_project_item_changes } from "../../shared/project/project-item-write-planner";
import { describe, expect, it } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import { ItemCache } from "./item-cache";

describe("ItemCache", () => {
  it("局部范围与全量重复协调等价，跳过成员只在显式目标中读取", () => {
    const cache = new ItemCache();
    const items = [
      create_item(1, { src: "同文", status: "NONE", name_src: ["甲", "乙"] }),
      create_item(2, { src: "同文", status: "DUPLICATED", name_src: ["甲", "乙"] }),
      create_item(3, { src: "同文", status: "ERROR", name_src: ["甲", "乙"] }),
      create_item(4, { src: "同文", status: "RULE_SKIPPED", name_src: ["甲", "乙"] }),
      create_item(5, { src: "同文", status: "NONE", name_src: ["丙"] }),
      create_item(6, { src: "同文", status: "NONE", file_path: "other.txt" }),
    ];
    cache.replace(items);
    expect(cache.readWriteScope([1])).toEqual([1, 2, 3]);
    expect(cache.readWriteScope([4])).toEqual([1, 2, 3, 4]);
    for (const enabled of [false, true])
      for (const target of items) {
        for (const status of ["NONE", "DUPLICATED", "PROCESSED", "ERROR", "EXCLUDED"] as const) {
          const explicit_changes = [
            { item_id: target.item_id, current: target, next: { ...target, status } },
          ];
          const scope = new Set(cache.readWriteScope([target.item_id]));
          expect(
            plan_project_item_changes({
              items: items.filter((item) => scope.has(item.item_id)),
              explicit_changes,
              duplicate_filter_enabled: enabled,
            }),
          ).toEqual(
            plan_project_item_changes({
              items,
              explicit_changes,
              duplicate_filter_enabled: enabled,
            }),
          );
        }
      }
  });

  it("状态更新、新增、身份变化、删除与整表替换后范围仍然准确", () => {
    const cache = new ItemCache();
    const first = create_item(1, { src: "同文" });
    cache.replace([first, create_item(2, { src: "同文", status: "RULE_SKIPPED" })]);
    expect(cache.readWriteScope([1])).toEqual([1]);
    const delta = (records: ProjectItemPublicRecord[]) =>
      cache.applyChange(
        {
          mode: "delta",
          changedIds: records.map((item) => item.item_id),
        },
        records,
      );
    delta([create_item(2, { src: "同文", status: "PROCESSED" })]);
    expect(cache.readWriteScope([1])).toEqual([1, 2]);
    delta([create_item(3, { src: "同文" })]);
    expect(cache.readWriteScope([1])).toEqual([1, 2, 3]);
    delta([create_item(2, { src: "异文" })]);
    expect(cache.readWriteScope([1])).toEqual([1, 3]);
    cache.replace(cache.readItems().filter((item) => item.item_id !== 3));
    expect(cache.readWriteScope([1])).toEqual([1]);
    cache.replace([first, create_item(4, { src: "同文" })]);
    expect(cache.readWriteScope([1])).toEqual([1, 4]);
    cache.clear();
    expect(cache.readWriteScope([1])).toEqual([1]);
  });

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

  it("规范行增量更新译文并保留顺序与文件元数据", () => {
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
      },
      [create_item(1, { file_path: "a.txt", src: "A", dst: "译文 A", status: "PROCESSED" })],
    );
    cache.applyChange(
      {
        mode: "delta",
        changedIds: [3, 4],
      },
      [
        create_item(3, { file_path: "c.txt", src: "C", dst: "译文 C" }),
        create_item(4, { file_path: "c.txt", src: "D", dst: "译文 D" }),
      ],
    );

    expect(cache.readItems().map((item) => item["item_id"])).toEqual([1, 2, 3, 4]);
    const files = cache.readFileMetadata();
    expect(files).toEqual([
      { file_path: "a.txt", file_type: "TXT" },
      { file_path: "c.txt", file_type: "TXT" },
    ]);
    files[0]!.file_path = "changed";
    expect(cache.readItem(1)?.file_path).toBe("a.txt");
    expect(cache.readItem(1)).toMatchObject({
      item_id: 1,
      file_path: "a.txt",
      src: "A",
      dst: "译文 A",
      status: "PROCESSED",
    });
  });
});

/** 默认文本条目只覆盖用例需要变化的字段。 */
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
    skip_internal_filter: false,
    ...overrides,
  };
}
