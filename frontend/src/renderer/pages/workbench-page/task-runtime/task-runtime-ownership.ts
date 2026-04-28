export type WorkbenchTaskRuntimeKind = "translation" | "analysis";

type TaskSnapshotWithKind = {
  task_type?: unknown;
};

export function is_task_snapshot_for_runtime(
  task_snapshot: TaskSnapshotWithKind,
  runtime_kind: WorkbenchTaskRuntimeKind,
): boolean {
  return String(task_snapshot.task_type ?? "") === runtime_kind;
}

export function should_defer_runtime_snapshot_refresh(
  task_snapshot: TaskSnapshotWithKind & { busy?: unknown },
  runtime_kind: WorkbenchTaskRuntimeKind,
): boolean {
  return Boolean(task_snapshot.busy) && !is_task_snapshot_for_runtime(task_snapshot, runtime_kind);
}
