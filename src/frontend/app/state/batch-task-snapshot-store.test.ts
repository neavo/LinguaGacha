import { expect, it, vi } from "vitest";
import { create_batch_task_snapshot, empty_batch_task_progress } from "@domain/batch-task";
import { createBatchTaskSnapshotStore } from "./batch-task-snapshot-store";

it("任务镜像隔离输入，拒绝旧修订，并按订阅生命周期通知", () => {
  const store = createBatchTaskSnapshotStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const progress = { ...empty_batch_task_progress("request", 2) };
  const first = {
    project_path: "project.lg",
    revision: 1,
    tasks: [{ ...create_batch_task_snapshot("first", "request", "agent"), progress }],
  };
  store.applySnapshot(first);
  progress.succeeded = 2;
  expect(store.getSnapshot().tasks[0]?.progress?.succeeded).toBe(0);
  const next = {
    ...first,
    revision: 3,
    tasks: [create_batch_task_snapshot("next", "translation", "standalone")],
  };
  store.applySnapshot(next);
  const current = store.getSnapshot();
  store.applySnapshot({ ...first, revision: 2 });
  expect(store.getSnapshot()).toBe(current);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  store.applySnapshot({ ...next, revision: 4 });
  expect(listener).toHaveBeenCalledTimes(2);
});
