import { describe, expect, it } from "vitest";

import { read_task_item_id, read_task_item_status } from "./translation-item";

describe("task item", () => {
  it("统一读取任务项身份、状态和可分析性", () => {
    const item = { item_id: "7", src: "正文", status: "NONE" };

    expect(read_task_item_id(item)).toBe(7);
    expect(read_task_item_status(item)).toBe("NONE");
  });
});
