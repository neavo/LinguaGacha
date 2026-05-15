import { AppError, type AppErrorPublicDetails } from "../app-error";

/**
 * WorkerFailedError 表示 worker_threads 或 work unit 通道失败。
 */
export class WorkerFailedError extends AppError {
  /**
   * worker 失败的原始异常链保存在 cause，任务日志只展示安全文案。
   */
  public constructor(
    args: {
      public_details?: AppErrorPublicDetails;
      diagnostic_context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super({ code: "worker.failed", ...args });
  }
}
