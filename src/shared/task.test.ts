import { describe, expect, it } from "vitest";

import {
  is_active_analysis_task_status,
  is_active_translation_task_status,
  is_task_idle_status,
  is_task_skipped_item_status,
  is_task_type,
  normalize_task_type,
} from "./task";

describe("task 基础模型", () => {
  it("识别公开任务类型和任务终态", () => {
    expect(is_task_type("translation")).toBe(true);
    expect(is_task_type("legacy")).toBe(false);
    expect(normalize_task_type("analysis")).toBe("analysis");
    expect(normalize_task_type("legacy")).toBe("translation");
    expect(is_task_idle_status("done")).toBe(true);
  });

  it("集中维护运行态派生判断", () => {
    expect(is_active_translation_task_status("running")).toBe(true);
    expect(is_active_analysis_task_status("running")).toBe(true);
    expect(is_task_skipped_item_status("RULE_SKIPPED")).toBe(true);
  });
});
