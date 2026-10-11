import { describe, expect, it } from "vitest";

import type { ItemStatus } from "../../domain/item";
import {
  coordinate_project_duplicate_statuses,
  type ProjectDuplicateItem,
} from "./project-item-duplicates";

describe("project item duplicate coordination", () => {
  it("按稳定身份选择唯一待翻译代表", () => {
    expect(
      coordinate_project_duplicate_statuses(
        [item(3, "NONE"), item(2, "DUPLICATED"), item(1, "NONE")],
        true,
      ),
    ).toEqual([{ item_id: 3, status: "DUPLICATED" }]);
  });

  it.each(["PROCESSED", "ERROR"] as const)("%s 条目承担重复组代表", (status) => {
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

  it("按可见角色名区分重复组", () => {
    expect(
      coordinate_project_duplicate_statuses(
        [
          item(1, "NONE", { name_src: "甲" }),
          item(2, "NONE", { name_src: ["甲", "附加列"] }),
          item(3, "NONE", { name_src: "乙" }),
          item(4, "NONE", { name_src: "甲" }),
        ],
        true,
      ),
    ).toEqual([
      { item_id: 2, status: "DUPLICATED" },
      { item_id: 4, status: "DUPLICATED" },
    ]);
  });
});

/** 构造只包含重复协调所需字段的测试条目。 */
function item(
  item_id: number,
  status: ItemStatus,
  overrides: Partial<ProjectDuplicateItem> = {},
): ProjectDuplicateItem {
  return {
    item_id,
    src: "同文",
    name_src: null,
    status,
    ...overrides,
  };
}
