import { describe, expect, it } from "vitest";
import {
  empty_batch_task_snapshot,
  read_batch_task_snapshot,
  batch_task_metrics,
} from "./batch-task";
import { empty_batch_task_progress } from "../domain/batch-task";
describe("共享批次展示", () => {
  it("本轮失败计入处理进度，预计时间和速度使用同一轮数据", () => {
    const snapshot = {
      ...empty_batch_task_snapshot(),
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
      batch_task_metrics(read_batch_task_snapshot({ batch_task: snapshot }), 20),
    ).toMatchObject({
      completion_percent: 40,
      elapsed_seconds: 10,
      remaining_seconds: 15,
      average_generation_speed: 4,
    });
  });
  it("未知目标与已知零目标分别显示", () => {
    expect(batch_task_metrics(empty_batch_task_snapshot(), 0).completion_percent).toBeNull();
    expect(
      batch_task_metrics(
        { ...empty_batch_task_snapshot(), progress: empty_batch_task_progress("item", 0) },
        0,
      ),
    ).toMatchObject({ total: 0, completion_percent: 0 });
  });
  it("拒绝不一致计数，并隔离传输引用", () => {
    const snapshot = {
      ...empty_batch_task_snapshot(),
      progress: empty_batch_task_progress("item", 1),
    };
    const parsed = read_batch_task_snapshot({ batch_task: snapshot });
    expect(parsed.progress).not.toBe(snapshot.progress);
    expect(() =>
      read_batch_task_snapshot({
        batch_task: { ...snapshot, progress: { ...snapshot.progress, succeeded: 2 } },
      }),
    ).toThrow();
  });
});
