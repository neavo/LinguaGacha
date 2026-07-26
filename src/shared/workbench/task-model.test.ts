import { describe, expect, it } from "vitest";

import {
  create_empty_workbench_task_snapshot,
  normalize_workbench_task_snapshot_payload,
  resolve_workbench_task_display_snapshot,
  resolve_workbench_task_metrics,
} from "./task-model";

describe("workbench task model", () => {
  it("从顶层读取运行态并从嵌套 progress 读取进度", () => {
    expect(
      normalize_workbench_task_snapshot_payload(
        {
          run_revision: 7,
          task_type: "translation",
          status: "RUNNING",
          busy: true,
          progress: {
            line: 3,
            total_line: 4,
            total_output_tokens: 20,
          },
        },
        "analysis",
      ),
    ).toMatchObject({
      run_revision: 7,
      task_type: "translation",
      status: "running",
      busy: true,
      line: 3,
      total_line: 4,
      total_output_tokens: 20,
    });
  });

  it("终态当前快照不会被历史停止中快照覆盖", () => {
    const current_snapshot = {
      ...create_empty_workbench_task_snapshot("translation"),
      status: "idle",
      line: 1,
      total_line: 2,
    };
    const stale_stopping_snapshot = {
      ...current_snapshot,
      status: "stopping",
      busy: true,
    };

    expect(
      resolve_workbench_task_display_snapshot({
        current_snapshot,
        last_snapshot: stale_stopping_snapshot,
        is_active: (status) => status === "running" || status === "stopping",
        has_display_state: (snapshot) => (snapshot?.line ?? 0) > 0,
      }),
    ).toBe(current_snapshot);
  });

  it("从任务行进度计算百分比和剩余时间", () => {
    const metrics = resolve_workbench_task_metrics({
      snapshot: {
        ...create_empty_workbench_task_snapshot("analysis"),
        status: "running",
        line: 3,
        total_line: 4,
        processed_line: 2,
        total_output_tokens: 30,
        start_time: 2,
      },
      now_seconds: 8,
      active: true,
    });

    expect(metrics).toMatchObject({
      active: true,
      completion_percent: 75,
      processed_count: 2,
      elapsed_seconds: 6,
      remaining_seconds: 2,
      average_output_speed: 5,
      output_tokens: 30,
    });
  });
});
