import { describe, expect, it } from "vitest";
import { normalize_batch_translation_progress } from "../../domain/batch-translation";
import {
  create_empty_batch_translation_snapshot,
  normalize_batch_translation_snapshot,
  clone_translation_task_snapshot,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
} from "./batch-translation";

describe("批量翻译展示", () => {
  it("进度与 scope 在读取边界归一化，克隆隔离引用", () => {
    const snapshot = normalize_batch_translation_snapshot({
      batch_translation: {
        revision: 7,
        status: "running",
        progress: normalize_batch_translation_progress({ line: 3, total_line: 4 }),
        scope: { kind: "items", item_ids: [2, 3, 2, -1] },
      },
    });
    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [2, 3] });
    const cloned = clone_translation_task_snapshot(snapshot);
    cloned.progress.line = 9;
    if (cloned.scope.kind === "items") cloned.scope.item_ids.push(9);
    expect(snapshot.progress.line).toBe(3);
    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [2, 3] });
  });
  it("已知总量的当前快照优先于历史停止态", () => {
    const snapshot = create_empty_batch_translation_snapshot();
    snapshot.progress.total_line = 2;
    expect(
      resolve_translation_task_display_snapshot({
        current_snapshot: snapshot,
        last_snapshot: { ...snapshot, status: "stopping" },
      }),
    ).toBe(snapshot);
  });
  it("空闲当前快照回退到有结果的历史终态", () => {
    const snapshot = create_empty_batch_translation_snapshot();
    const last = create_empty_batch_translation_snapshot();
    last.progress.line = 2;
    last.status = "done";
    expect(
      resolve_translation_task_display_snapshot({
        current_snapshot: snapshot,
        last_snapshot: last,
      }),
    ).toBe(last);
  });
  it("进度计算完成度、剩余时间和生成速度", () => {
    const snapshot = create_empty_batch_translation_snapshot();
    snapshot.status = "running";
    Object.assign(snapshot.progress, {
      line: 3,
      total_line: 4,
      processed_line: 2,
      total_tokens: 90,
      total_input_tokens: 40,
      total_reasoning_tokens: 20,
      total_output_tokens: 30,
      start_time: 2,
    });
    expect(resolve_translation_task_metrics({ snapshot, now_seconds: 8 })).toMatchObject({
      active: true,
      completion_percent: 75,
      processed_count: 2,
      elapsed_seconds: 6,
      remaining_seconds: 2,
      average_generation_speed: 50 / 6,
      input_tokens: 40,
      reasoning_tokens: 20,
      output_tokens: 30,
    });
  });
});
