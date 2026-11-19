import { describe, expect, it } from "vitest";

import type { ItemStatus } from "../../domain/item";
import {
  plan_project_item_changes,
  type ProjectItemWriteRecord,
} from "./project-item-write-planner";

describe("project item write planner", () => {
  it("排除代表时只晋升下一条，撤销的状态变化不写入", () => {
    const current = item(1, "NONE");
    const last = item(3, "DUPLICATED");
    expect(
      plan_project_item_changes({
        items: [current, item(2, "DUPLICATED"), last],
        explicit_changes: [
          change(current, { ...current, status: "EXCLUDED" }),
          change(last, { ...last, status: "NONE" }),
        ],
        duplicate_filter_enabled: true,
      }),
    ).toMatchObject([
      { item_id: 1, next: { status: "EXCLUDED" } },
      { item_id: 2, next: { status: "NONE" } },
    ]);
  });

  it("完成任一重复项时把原待翻译代表转为被动重复状态", () => {
    const current = item(2, "DUPLICATED");
    expect(
      plan_project_item_changes({
        items: [item(1, "NONE"), current],
        explicit_changes: [change(current, { ...current, dst: "译文", status: "PROCESSED" })],
        duplicate_filter_enabled: true,
      }),
    ).toMatchObject([
      { item_id: 1, next: { status: "DUPLICATED" } },
      {
        item_id: 2,
        next: { dst: "译文", status: "PROCESSED" },
      },
    ]);
  });
});

/** 构造同一重复组中的完整写入测试事实。 */
function item(item_id: number, status: ItemStatus): ProjectItemWriteRecord {
  return {
    item_id,
    file_path: "demo.txt",
    row_number: item_id - 1,
    src: "同文",
    name_src: null,
    dst: "",
    name_dst: null,
    status,
  };
}

/** 用测试条目的前后事实表达显式更新。 */
function change(current: ProjectItemWriteRecord, next: ProjectItemWriteRecord) {
  return { item_id: current.item_id, current, next };
}
