import { describe, expect, it } from "vitest";

import {
  build_analysis_checkpoint_status_map,
  is_analyzable_task_item,
  read_task_item_id,
  read_task_item_status,
} from "./task-item";

describe("task item", () => {
  it("统一读取任务项身份、状态和可分析性", () => {
    const item = { item_id: "7", src: "正文", status: "NONE" };

    expect(read_task_item_id(item)).toBe(7);
    expect(read_task_item_status(item)).toBe("NONE");
    expect(is_analyzable_task_item(item)).toBe(true);
    expect(is_analyzable_task_item({ ...item, status: "EXCLUDED" })).toBe(false);
    expect(is_analyzable_task_item({ ...item, src: "  " })).toBe(false);
  });

  it("checkpoint 只保留有效身份与进度状态", () => {
    const statuses = build_analysis_checkpoint_status_map([
      { item_id: 1, status: "NONE" },
      { item_id: 2, status: "PROCESSED" },
      { item_id: 0, status: "ERROR" },
      { item_id: 3, status: "invalid" },
    ]);

    expect([...statuses]).toEqual([
      [1, "NONE"],
      [2, "PROCESSED"],
    ]);
  });
});
