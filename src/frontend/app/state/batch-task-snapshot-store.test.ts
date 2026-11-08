import { expect, it, vi } from "vitest";
import { empty_batch_task_snapshot } from "@shared/batch-task";
import { empty_batch_task_progress } from "@domain/batch-task";
import { createBatchTaskSnapshotStore } from "./batch-task-snapshot-store";

it("任务镜像隔离输入，拒绝旧修订，并按订阅生命周期通知", () => {
  const store = createBatchTaskSnapshotStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const first = {
    ...empty_batch_task_snapshot(),
    revision: 1,
    run_id: "first",
    progress: { ...empty_batch_task_progress("request", 2) },
  };
  store.applySnapshot(first);
  first.progress.succeeded = 2;
  expect(store.getSnapshot().progress?.succeeded).toBe(0);
  const next = { ...empty_batch_task_snapshot(), revision: 3, run_id: "next" };
  store.applySnapshot(next);
  const current = store.getSnapshot();
  store.applySnapshot({ ...first, revision: 2 });
  expect(store.getSnapshot()).toBe(current);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  store.applySnapshot({ ...next, revision: 4 });
  expect(listener).toHaveBeenCalledTimes(2);
});
