import { describe, expect, it } from "vitest";

import type { ItemStatus } from "../../domain/item";
import {
  coordinate_project_duplicate_statuses,
  type ProjectDuplicateItem,
} from "./project-item-duplicates";

describe("project item duplicate coordination", () => {
  it("按行号和身份稳定选择唯一待翻译代表", () => {
    expect(
      coordinate_project_duplicate_statuses(
        [item(3, "NONE", 2), item(2, "DUPLICATED", 0), item(1, "NONE", 0)],
        true,
      ),
    ).toEqual([{ item_id: 3, status: "DUPLICATED" }]);
  });

  it.each(["PROCESSED", "ERROR"] as const)("%s 条目承担同文组代表", (status) => {
    expect(
      coordinate_project_duplicate_statuses(
        [item(1, status), item(2, "NONE"), item(3, "DUPLICATED")],
        true,
      ),
    ).toEqual([{ item_id: 2, status: "DUPLICATED" }]);
  });

  it("排除和过滤状态不承担代表且不会被协调器覆盖", () => {
    expect(
      coordinate_project_duplicate_statuses(
        [item(1, "EXCLUDED"), item(2, "RULE_SKIPPED"), item(3, "DUPLICATED")],
        true,
      ),
    ).toEqual([{ item_id: 3, status: "NONE" }]);
  });

  it("关闭过滤时恢复所有被动重复状态", () => {
    expect(
      coordinate_project_duplicate_statuses([item(1, "DUPLICATED"), item(2, "DUPLICATED")], false),
    ).toEqual([
      { item_id: 1, status: "NONE" },
      { item_id: 2, status: "NONE" },
    ]);
  });

  it("相同原文不会跨文件形成重复组", () => {
    expect(
      coordinate_project_duplicate_statuses(
        [item(1, "NONE"), item(2, "NONE", 1, "other.txt")],
        true,
      ),
    ).toEqual([]);
  });
});

/** 构造只包含重复协调所需字段的测试条目。 */
function item(
  item_id: number,
  status: ItemStatus,
  row_number = item_id,
  file_path = "script.txt",
): ProjectDuplicateItem {
  return { item_id, file_path, row_number, src: "同文", status };
}
