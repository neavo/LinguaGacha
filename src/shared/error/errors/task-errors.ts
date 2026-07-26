import { AppError, type AppErrorArgs } from "../app-error";

/** 后台任务占用导致当前命令或写入被拒绝。 */
export class TaskBusyError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "task.busy", ...args });
  }
}
