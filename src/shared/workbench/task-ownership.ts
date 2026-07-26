import type { PromptKind } from "../../domain/prompt";

type WorkbenchTaskKind = PromptKind;

type TaskSnapshotWithKind = {
  task_type?: unknown;
};

// 其它类型任务忙碌时延后本页刷新，避免把共享 busy 状态误认成本任务。
export function should_defer_task_snapshot_refresh(
  task_snapshot: TaskSnapshotWithKind & { busy?: unknown },
  task_kind: WorkbenchTaskKind,
): boolean {
  return Boolean(task_snapshot.busy) && String(task_snapshot.task_type ?? "") !== task_kind;
}
