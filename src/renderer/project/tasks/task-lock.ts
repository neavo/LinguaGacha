export type TaskLockSnapshot = {
  busy: boolean;
  status: string;
};

export function is_task_mutation_locked(task_snapshot: Pick<TaskLockSnapshot, "busy">): boolean {
  return task_snapshot.busy;
}

export function is_task_stopping(task_snapshot: Pick<TaskLockSnapshot, "status">): boolean {
  return task_snapshot.status === "STOPPING";
}
