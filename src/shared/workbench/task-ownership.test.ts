import { describe, expect, it } from "vitest";

import { should_defer_task_snapshot_refresh } from "./task-ownership";

describe("workbench-ownership", () => {
  it.each([
    [{ task_type: "analysis", busy: true }, true],
    [{ task_type: "analysis", busy: false }, false],
    [{ task_type: "translation", busy: true }, false],
  ] as const)("只在其他任务忙碌时延后当前运行态刷新", (snapshot, expected) => {
    expect(should_defer_task_snapshot_refresh(snapshot, "translation")).toBe(expected);
  });
});
