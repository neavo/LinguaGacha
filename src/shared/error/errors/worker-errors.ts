import { AppError, type AppErrorArgs } from "../app-error";

/** worker_threads 或 work-unit 通道失败。 */
export class WorkerFailedError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "worker.failed", ...args });
  }
}

/** worker 已接收任务但执行结果失败。 */
export class WorkerExecutionFailedError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "worker.execution_failed", ...args });
  }
}
