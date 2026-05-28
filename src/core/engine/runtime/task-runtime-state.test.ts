import { describe, expect, it } from "vitest";

import type { TranslationScope } from "../../../domain/task";
import { TaskRuntimeState } from "./task-runtime-state";

describe("TaskRuntimeState", () => {
  it("启动重翻任务时归一 items scope 并返回不可变快照", () => {
    const state = new TaskRuntimeState();

    state.begin_task("translation", {
      kind: "items",
      item_ids: [3, 3, 0, 2.9, 4],
    } as unknown as TranslationScope);

    const snapshot = state.snapshot();
    expect(snapshot).toMatchObject({
      status: "requested",
      busy: true,
      active_task_type: "translation",
      translation_scope: { kind: "items", item_ids: [3, 2, 4] },
    });
    if (snapshot.translation_scope.kind !== "items") {
      throw new Error("期望重翻 items scope");
    }

    snapshot.translation_scope.item_ids.push(99);

    expect(state.snapshot().translation_scope).toEqual({
      kind: "items",
      item_ids: [3, 2, 4],
    });
  });

  it("请求压力只保留非负整数并在任务结束时归零", () => {
    const state = new TaskRuntimeState();

    state.begin_task("analysis");
    state.set_request_in_flight_count("analysis", 2.9);

    expect(state.snapshot()).toMatchObject({
      active_task_type: "analysis",
      request_in_flight_count: 2,
    });

    state.set_request_in_flight_count("analysis", -10);
    expect(state.snapshot().request_in_flight_count).toBe(0);

    state.set_request_in_flight_count("analysis", 5);
    state.set_status("analysis", "done", false);

    expect(state.snapshot()).toMatchObject({
      status: "done",
      busy: false,
      active_task_type: "idle",
      request_in_flight_count: 0,
    });
  });

  it("恢复命令失败前快照时保留上一轮公开运行态", () => {
    const state = new TaskRuntimeState();

    state.begin_task("translation", { kind: "items", item_ids: [7, 8] });
    state.set_request_in_flight_count("translation", 2);
    const previous_snapshot = state.snapshot();

    state.begin_task("translation", { kind: "all" });
    state.set_request_in_flight_count("translation", 5);
    state.restore(previous_snapshot);

    expect(state.snapshot()).toMatchObject({
      status: "requested",
      busy: true,
      active_task_type: "translation",
      request_in_flight_count: 2,
      translation_scope: { kind: "items", item_ids: [7, 8] },
    });
  });

  it("重翻提交完成后从行级范围移除已回写 item", () => {
    const state = new TaskRuntimeState();

    state.begin_task("translation", { kind: "items", item_ids: [1, 2, 3] });

    state.remove_translation_item_ids([2, 3.8, -1]);
    expect(state.snapshot().translation_scope).toEqual({
      kind: "items",
      item_ids: [1],
    });

    state.remove_translation_item_ids([1]);
    expect(state.snapshot().translation_scope).toEqual({
      kind: "items",
      item_ids: [],
    });
  });
});
