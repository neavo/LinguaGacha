import { AppError, type AppErrorArgs } from "../app-error";

/** 模型配置引用不存在或当前没有可用激活模型。 */
export class ModelNotFoundError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "model.not_found", ...args });
  }
}

/** 包装外部模型服务失败，供应商原始响应不得进入公开载荷。 */
export class ModelProviderFailedError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "model.provider_failed", ...args });
  }
}
