import { describe, expect, it } from "vitest";

import {
  create_empty_analysis_task_snapshot,
  normalize_analysis_task_snapshot_payload,
  resolve_analysis_task_display_snapshot,
  resolve_analysis_task_metrics,
} from "./analysis-task";

describe("analysis-task-model", () => {
  it("从 extras 读取候选计数并保留候选终态展示", () => {
    const snapshot = normalize_analysis_task_snapshot_payload({
      task: {
        status: "done",
        extras: { candidate_count: 3 },
      },
    });

    expect(snapshot.candidate_count).toBe(3);
    expect(
      resolve_analysis_task_display_snapshot({
        current_snapshot: snapshot,
        last_snapshot: null,
      }),
    ).toBe(snapshot);
  });

  it("分析指标把异常候选计数收敛为非负值", () => {
    const metrics = resolve_analysis_task_metrics({
      snapshot: {
        ...create_empty_analysis_task_snapshot(),
        candidate_count: -1,
      },
      now_seconds: 10,
    });

    expect(metrics.candidate_count).toBe(0);
  });
});
