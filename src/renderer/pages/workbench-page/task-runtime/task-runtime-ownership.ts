import type { PromptKind } from "@domain/prompt";

type WorkbenchTaskRuntimeKind = PromptKind;

type TaskSnapshotWithKind = {
  task_type?: unknown;
};

/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_snapshot_for_runtime(
  task_snapshot: TaskSnapshotWithKind,
  runtime_kind: WorkbenchTaskRuntimeKind,
): boolean {
  return String(task_snapshot.task_type ?? "") === runtime_kind;
}

/**
 * 判断当前值是否满足业务条件。
 */
export function should_defer_task_snapshot_refresh(
  task_snapshot: TaskSnapshotWithKind & { busy?: unknown },
  runtime_kind: WorkbenchTaskRuntimeKind,
): boolean {
  return Boolean(task_snapshot.busy) && !is_task_snapshot_for_runtime(task_snapshot, runtime_kind);
}
