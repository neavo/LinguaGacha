import { AppError, type AppErrorArgs } from "../app-error";

/**
 * WorkerFailedError 表示 worker_threads 或 work unit 通道失败。
 */
export class WorkerFailedError extends AppError {
  /**
   * worker 失败的原始异常链保存在 cause，任务日志只展示安全文案。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "worker.failed", ...args });
  }
}

/**
 * WorkerExecutionFailedError 表示 worker 已接收任务但执行结果失败。
 */
export class WorkerExecutionFailedError extends AppError {
  /**
   * worker 返回的失败摘要进入 cause 或诊断上下文，对外只展示稳定错误码文案。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "worker.execution_failed", ...args });
  }
}
