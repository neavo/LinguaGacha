import type { PromptKind } from "../../domain/prompt";

type WorkbenchTaskKind = PromptKind;

type TaskSnapshotWithKind = {
  task_type?: unknown;
};

/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_snapshot_for_kind(
  task_snapshot: TaskSnapshotWithKind,
  task_kind: WorkbenchTaskKind,
): boolean {
  return String(task_snapshot.task_type ?? "") === task_kind;
}

/**
 * 判断当前值是否满足业务条件。
 */
export function should_defer_task_snapshot_refresh(
  task_snapshot: TaskSnapshotWithKind & { busy?: unknown },
  task_kind: WorkbenchTaskKind,
): boolean {
  return Boolean(task_snapshot.busy) && !is_task_snapshot_for_kind(task_snapshot, task_kind);
}
