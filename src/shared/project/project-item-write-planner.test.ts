import { describe, expect, it } from "vitest";

import type { ItemStatus } from "../../domain/item";
import {
  plan_project_item_changes,
  type ProjectItemWriteRecord,
} from "./project-item-write-planner";

describe("project item write planner", () => {
  it("显式排除代表项时在同一计划中晋升后续重复项", () => {
    const current = item(1, "NONE");
    expect(
      plan_project_item_changes({
        items: [current, item(2, "DUPLICATED")],
        explicit_changes: [change(current, { ...current, status: "EXCLUDED" })],
        duplicate_filter_enabled: true,
      }).map(({ item_id, patch }) => ({ item_id, patch })),
    ).toEqual([
      { item_id: 1, patch: { status: "EXCLUDED" } },
      { item_id: 2, patch: { status: "NONE" } },
    ]);
  });

  it("完成任一重复项时把原待翻译代表转为被动重复状态", () => {
    const current = item(2, "DUPLICATED");
    expect(
      plan_project_item_changes({
        items: [item(1, "NONE"), current],
        explicit_changes: [
          change(current, { ...current, dst: "译文", status: "PROCESSED", retry_count: 0 }),
        ],
        duplicate_filter_enabled: true,
      }).map(({ item_id, patch }) => ({ item_id, patch })),
    ).toEqual([
      { item_id: 1, patch: { status: "DUPLICATED" } },
      {
        item_id: 2,
        patch: { dst: "译文", status: "PROCESSED", retry_count: 0 },
      },
    ]);
  });
});

/** 构造同一重复组中的完整写入测试事实。 */
function item(item_id: number, status: ItemStatus): ProjectItemWriteRecord {
  return {
    item_id,
    file_path: "script.txt",
    row_number: item_id - 1,
    src: "同文",
    dst: "",
    name_dst: null,
    status,
    retry_count: 2,
  };
}

/** 用测试条目的前后事实表达显式更新。 */
function change(current: ProjectItemWriteRecord, next: ProjectItemWriteRecord) {
  return { item_id: current.item_id, current, next };
}
