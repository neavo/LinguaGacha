import { WorkerFailedError, type LogError } from "../../../shared/error";

/**
 * worker 或 LLM adapter 传输失败时使用专门错误，翻译 chunk 可走可恢复重试
 */
export class WorkUnitExecutorTransportError extends WorkerFailedError {
  public readonly cause_error: unknown; // 保留原始异常链路，便于日志区分通道失败和业务失败

  /**
   * 保留原始异常链路，方便任务日志区分 worker 通道失败和业务失败
   */
  public constructor(error: LogError, cause_error: unknown) {
    super({ cause: cause_error, diagnostic_context: { failure: error } });
    this.name = "WorkUnitExecutorTransportError";
    this.cause_error = cause_error;
  }
}
