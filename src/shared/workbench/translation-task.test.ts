import { describe, expect, it } from "vitest";

import {
  clone_translation_task_snapshot,
  create_empty_translation_task_snapshot,
  normalize_translation_task_snapshot_payload,
  resolve_translation_task_display_snapshot,
  resolve_translation_task_metrics,
} from "./translation-task";

describe("translation-task-model", () => {
  it("终态当前快照不会被历史停止中快照覆盖", () => {
    const current_snapshot = {
      ...create_empty_translation_task_snapshot(),
      status: "idle",
      busy: false,
      line: 1,
      total_line: 2,
      total_output_tokens: 19,
      time: 6,
    };
    const stale_stopping_snapshot = {
      ...create_empty_translation_task_snapshot(),
      status: "stopping",
      busy: true,
      line: 1,
      total_line: 2,
      total_output_tokens: 19,
      start_time: 100,
    };

    const display_snapshot = resolve_translation_task_display_snapshot({
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
    const metrics = resolve_translation_task_metrics({
      snapshot: {
        ...create_empty_translation_task_snapshot(),
        status: "running",
        busy: true,
        line: 3,
        total_line: 4,
      },
      now_seconds: 10,
    });

    expect(metrics.completion_percent).toBe(75);
  });

  it("空翻译任务快照默认属于完整翻译范围", () => {
    expect(create_empty_translation_task_snapshot().scope).toEqual({ kind: "all" });
  });

  it("从任务 extras 归一化局部重翻范围", () => {
    const snapshot = normalize_translation_task_snapshot_payload({
      task: {
        status: "done",
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [2, "3", 2, -1],
          },
        },
      },
    });

    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [2, 3] });
  });

  it("从任务 extras 保留空局部重翻范围", () => {
    const snapshot = normalize_translation_task_snapshot_payload({
      task: {
        status: "running",
        extras: {
          kind: "translation",
          scope: {
            kind: "items",
            item_ids: [],
          },
        },
      },
    });

    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [] });
  });

  it("克隆翻译任务快照时深拷贝局部重翻范围", () => {
    const snapshot = create_empty_translation_task_snapshot();
    snapshot.scope = { kind: "items", item_ids: [1, 2] };

    const cloned_snapshot = clone_translation_task_snapshot(snapshot);
    if (cloned_snapshot.scope.kind !== "items") {
      throw new Error("期望局部重翻范围");
    }
    cloned_snapshot.scope.item_ids.push(3);

    expect(snapshot.scope).toEqual({ kind: "items", item_ids: [1, 2] });
  });
});
