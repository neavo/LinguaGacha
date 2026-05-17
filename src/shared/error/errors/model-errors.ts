import { AppError, type AppErrorArgs } from "../app-error";

/**
 * ModelNotFoundError 表示模型配置引用不存在或无可用激活模型。
 */
export class ModelNotFoundError extends AppError {
  /**
   * 模型缺失只暴露稳定 code，具体原因进入诊断上下文。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "model.not_found", ...args });
  }
}

/**
 * ModelProviderFailedError 包装外部模型服务失败。
 */
export class ModelProviderFailedError extends AppError {
  /**
   * HTTP status 等安全摘要可公开，provider 原始响应只能作为 cause 进入日志。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "model.provider_failed", ...args });
  }
}
