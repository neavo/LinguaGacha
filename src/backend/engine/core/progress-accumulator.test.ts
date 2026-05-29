import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaskProgressSnapshot } from "./engine-options";
import { TaskProgressSnapshotTool } from "./progress-accumulator";

describe("TaskProgressSnapshotTool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("从数据库 meta 恢复固定进度字段并过滤坏值", () => {
    expect(
      TaskProgressSnapshotTool.from_record({
        start_time: 10.5,
        time: "bad",
        total_line: "3.8",
        line: 2.9,
        processed_line: null,
        error_line: "1.2",
        total_tokens: Number.NaN,
        total_input_tokens: 4.7,
        total_output_tokens: "6.9",
        extra: 999,
      }),
    ).toEqual({
      start_time: 10.5,
      time: 0,
      total_line: 3,
      line: 2,
      processed_line: 0,
      error_line: 1,
      total_tokens: 0,
      total_input_tokens: 4,
      total_output_tokens: 6,
    });

    expect(TaskProgressSnapshotTool.from_record([])).toEqual({
      start_time: 0,
      time: 0,
      total_line: 0,
      line: 0,
      processed_line: 0,
      error_line: 0,
      total_tokens: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
    });
  });

  it("累计 token 时以输入输出字段重建总数", () => {
    const snapshot = TaskProgressSnapshotTool.add_tokens(
      {
        ...TaskProgressSnapshotTool.empty(5, 100),
        total_tokens: 999,
        total_input_tokens: 1,
        total_output_tokens: 2,
      },
      2.9,
      3.1,
    );

    expect(snapshot).toMatchObject({
      total_input_tokens: 3,
      total_output_tokens: 5,
      total_tokens: 8,
    });
  });

  it("更新行数时用 processed 和 error 生成公开 line", () => {
    const snapshot = TaskProgressSnapshotTool.with_counts(TaskProgressSnapshotTool.empty(), {
      total_line: 4,
      processed_line: 2,
      error_line: 1,
    });

    expect(snapshot).toMatchObject({
      total_line: 4,
      processed_line: 2,
      error_line: 1,
      line: 3,
    });
  });

  it("按 start_time 计算耗时并保护无效开始时间", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:05.000Z"));
    const started_at = new Date("2026-01-01T00:00:02.000Z").getTime() / 1000;
    const base: TaskProgressSnapshot = {
      ...TaskProgressSnapshotTool.empty(1, started_at),
      time: 99,
    };

    expect(TaskProgressSnapshotTool.with_elapsed(base).time).toBe(3);
    expect(TaskProgressSnapshotTool.with_elapsed({ ...base, start_time: 0 }).time).toBe(0);
  });
});
