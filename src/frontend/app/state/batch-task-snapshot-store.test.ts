import { empty_batch_task_list_snapshot } from "@shared/batch-task";
import { expect, it, vi } from "vitest";
import { create_batch_task_snapshot, empty_batch_task_progress } from "@domain/batch-task";
import { createBatchTaskSnapshotStore } from "./batch-task-snapshot-store";

it("任务镜像隔离输入，拒绝旧修订，并按订阅生命周期通知", () => {
  const store = createBatchTaskSnapshotStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  const progress = { ...empty_batch_task_progress("request", 2) };
  const first = {
    ...empty_batch_task_list_snapshot(),
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

it("重连只交接本会话见过的独立翻译，重复快照和迟到回包最多消费一次", () => {
  const store = createBatchTaskSnapshotStore();
  const base = { ...empty_batch_task_list_snapshot(), project_path: "project.lg" };
  const receipt = {
    run_id: "translate",
    operation: "translate",
    status: "done",
    failed: 0,
  } as const;
  const finished = { ...base, revision: 5, last_translation: receipt };
  store.applySnapshot(finished);
  expect(store.takeTranslationCompletion()).toBeNull();

  const accepted = {
    ...base,
    revision: 4,
    tasks: [create_batch_task_snapshot("translate", "translation", "standalone")],
  };
  store.applySnapshot(accepted, "translate");
  expect(store.takeTranslationCompletion()).toEqual(receipt);
  store.applySnapshot(finished);
  store.applySnapshot(accepted, "translate");
  expect(store.takeTranslationCompletion()).toBeNull();

  store.applySnapshot({
    ...base,
    revision: 6,
    tasks: [create_batch_task_snapshot("next", "translation", "standalone")],
  });
  store.applySnapshot({ ...base, revision: 8, last_translation: { ...receipt, run_id: "next" } });
  expect(store.takeTranslationCompletion()).toMatchObject({ run_id: "next" });
});
