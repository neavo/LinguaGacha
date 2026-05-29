import { describe, expect, it } from "vitest";

import {
  create_empty_analysis_task_snapshot,
  resolve_analysis_task_display_snapshot,
  resolve_analysis_task_metrics,
} from "./analysis-task";

describe("analysis-task-model", () => {
  it("终态当前快照不会被历史停止中快照覆盖", () => {
    const current_snapshot = {
      ...create_empty_analysis_task_snapshot(),
      status: "idle",
      busy: false,
      line: 1,
      total_line: 2,
      candidate_count: 3,
      time: 6,
    };
    const stale_stopping_snapshot = {
      ...create_empty_analysis_task_snapshot(),
      status: "stopping",
      busy: true,
      line: 1,
      total_line: 2,
      candidate_count: 3,
      start_time: 100,
    };

    const display_snapshot = resolve_analysis_task_display_snapshot({
      current_snapshot,
      last_snapshot: stale_stopping_snapshot,
    });

    expect(display_snapshot).toMatchObject({
      status: "idle",
      busy: false,
      line: 1,
      total_line: 2,
    });
  });

  it("从任务快照计算运行中百分比", () => {
    const metrics = resolve_analysis_task_metrics({
      snapshot: {
        ...create_empty_analysis_task_snapshot(),
        status: "running",
        busy: true,
        line: 3,
        total_line: 4,
      },
      now_seconds: 10,
    });

    expect(metrics.completion_percent).toBe(75);
  });
});
