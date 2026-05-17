import { AppError, type AppErrorArgs } from "../app-error";

/**
 * TaskBusyError 统一表达后台任务占用导致的 mutation 拒绝。
 */
export class TaskBusyError extends AppError {
  /**
   * 调用点不重复拼 action，页面统一按 code 决定禁用或提示。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "task.busy", ...args });
  }
}
