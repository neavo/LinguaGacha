import { describe, expect, it } from "vitest";
import { read_batch_task_list_snapshot, batch_task_metrics } from "./batch-task";
import { create_batch_task_snapshot, empty_batch_task_progress } from "../domain/batch-task";
function wrap(...tasks: unknown[]) {
  return { batch_tasks: { revision: 1, project_path: "project.lg", tasks } };
}

describe("共享批次展示", () => {
  it("本轮失败计入处理进度，预计时间和速度使用同一轮数据", () => {
    const snapshot = {
      ...create_batch_task_snapshot("fixture", "request", "agent"),
      status: "running" as const,
      kind: "request" as const,
      progress: {
        ...empty_batch_task_progress("request", 10),
        failed: 4,
        start_time: 10,
        output_tokens: 40,
      },
    };
    expect(
      batch_task_metrics(read_batch_task_list_snapshot(wrap(snapshot)).tasks[0]!, 20),
    ).toMatchObject({
      completion_percent: 40,
      elapsed_seconds: 10,
      remaining_seconds: 15,
      average_generation_speed: 4,
    });
  });
  it("未知目标与已知零目标分别显示", () => {
    expect(batch_task_metrics(null, 0).completion_percent).toBeNull();
    expect(
      batch_task_metrics(
        {
          ...create_batch_task_snapshot("fixture", "request", "agent"),
          progress: empty_batch_task_progress("item", 0),
        },
        0,
      ),
    ).toMatchObject({ total: 0, completion_percent: 0 });
  });
  it("拒绝结算量超过本轮目标的快照", () => {
    const snapshot = {
      ...create_batch_task_snapshot("fixture", "request", "agent"),
      progress: empty_batch_task_progress("item", 1),
    };
    expect(() =>
      read_batch_task_list_snapshot(
        wrap({ ...snapshot, progress: { ...snapshot.progress, succeeded: 2 } }),
      ),
    ).toThrow();
  });
});
