import { describe, expect, it } from "vitest";

import {
  is_active_analysis_task_status,
  is_active_translation_task_status,
  is_task_idle_status,
  is_task_run_status,
  is_task_skipped_item_status,
  is_task_start_mode,
  is_task_type,
  normalize_task_progress_snapshot,
  normalize_task_type,
} from "./task";

describe("task 基础模型", () => {
  it("识别公开任务类型和任务终态", () => {
    expect(is_task_type("translation")).toBe(true);
    expect(is_task_type("legacy")).toBe(false);
    expect(normalize_task_type("analysis")).toBe("analysis");
    expect(normalize_task_type("legacy")).toBe("translation");
    expect(is_task_run_status("running")).toBe(true);
    expect(is_task_run_status("RUNNING")).toBe(false);
    expect(is_task_start_mode("reset")).toBe(true);
    expect(is_task_start_mode("resume")).toBe(false);
    expect(is_task_idle_status("done")).toBe(true);
  });

  it("集中维护运行态计算判断", () => {
    expect(is_active_translation_task_status("running")).toBe(true);
    expect(is_active_analysis_task_status("running")).toBe(true);
    expect(is_task_skipped_item_status("RULE_SKIPPED")).toBe(true);
  });

  it("进度归一化拒绝 NaN、Infinity、负数和额外字段", () => {
    expect(
      normalize_task_progress_snapshot({
        start_time: 1.5,
        time: Number.NaN,
        total_line: "4.9",
        line: Number.POSITIVE_INFINITY,
        processed_line: -2,
        error_line: 1.8,
        total_tokens: 7,
        total_input_tokens: 3,
        total_output_tokens: 4,
        extra: 99,
      }),
    ).toEqual({
      start_time: 1.5,
      time: 0,
      total_line: 4,
      line: 0,
      processed_line: 0,
      error_line: 1,
      total_tokens: 7,
      total_input_tokens: 3,
      total_output_tokens: 4,
    });
  });
});
