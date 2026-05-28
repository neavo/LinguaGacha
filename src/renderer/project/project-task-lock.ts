export type TaskLockSnapshot = {
  busy: boolean;
  status: string;
};

/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_mutation_locked(task_snapshot: Pick<TaskLockSnapshot, "busy">): boolean {
  return task_snapshot.busy;
}

/**
 * 判断当前值是否满足业务条件。
 */
export function is_task_stopping(task_snapshot: Pick<TaskLockSnapshot, "status">): boolean {
  return task_snapshot.status === "stopping";
}
