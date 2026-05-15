import { describe, expect, it } from "vitest";

import { TaskRunLock } from "./run-lock";

describe("TaskRunLock", () => {
  it("同一时间只允许一个后台任务占用", () => {
    const lock = new TaskRunLock();
    const first = lock.begin("translation");

    expect(() => lock.begin("analysis")).toThrow("task.busy");
    expect(lock.is_current(first.run_id)).toBe(true);

    lock.finish(first.run_id);
    expect(() => lock.begin("analysis")).not.toThrow();
  });

  it("停止请求只影响当前任务类型", () => {
    const lock = new TaskRunLock();
    const handle = lock.begin("translation");

    expect(lock.request_stop("analysis")).toBe(false);
    expect(handle.signal.aborted).toBe(false);
    expect(lock.request_stop("translation")).toBe(true);
    expect(handle.signal.aborted).toBe(true);
  });
});
