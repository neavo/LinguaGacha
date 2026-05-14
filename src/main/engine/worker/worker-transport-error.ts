/**
 * worker 或 LLM adapter 传输失败时使用专门错误，翻译 chunk 可走可恢复重试
 */
export class WorkUnitExecutorTransportError extends Error {
  public readonly cause_error: unknown; // cause_error 保留原始异常链路，便于日志区分通道失败和业务失败

  /**
   * 保留原始异常链路，方便任务日志区分 worker 通道失败和业务失败
   */
  public constructor(message: string, cause_error: unknown) {
    super(message);
    this.name = "WorkUnitExecutorTransportError";
    this.cause_error = cause_error;
  }
}
