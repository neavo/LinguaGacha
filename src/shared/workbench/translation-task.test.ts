import { describe, expect, it } from "vitest";

import {
  clone_translation_task_snapshot,
  create_empty_translation_task_snapshot,
  normalize_translation_task_snapshot_payload,
  resolve_translation_task_display_snapshot,
} from "./translation-task";

describe("translation-task-model", () => {
  it("已知任务总量时保留尚未开始的终态展示", () => {
    const snapshot = {
      ...create_empty_translation_task_snapshot(),
      status: "idle",
      total_line: 2,
    };

    expect(
      resolve_translation_task_display_snapshot({
        current_snapshot: snapshot,
        last_snapshot: null,
      }),
    ).toBe(snapshot);
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
