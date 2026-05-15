import { AppError, type AppErrorPublicDetails } from "../app-error";

/**
 * 请求校验失败由 API 边界和服务入口抛出，保持 renderer 只按稳定 code 分支。
 */
export class RequestValidationError extends AppError {
  /**
   * 校验错误只暴露稳定 code，内部细节必须拆到 details / diagnostic context。
   */
  public constructor(
    args: {
      public_details?: AppErrorPublicDetails;
      diagnostic_context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super({ code: "request.validation_failed", ...args });
  }
}

/**
 * JSON 解析失败是请求格式错误，不复用业务参数校验码。
 */
export class InvalidJsonError extends AppError {
  /**
   * 原始解析异常只作为 cause，不能进入公开 envelope。
   */
  public constructor(cause?: unknown) {
    super({ code: "request.invalid_json", cause });
  }
}

/**
 * 未注册路由只暴露请求 path，用于 renderer 和日志对齐。
 */
export class RouteNotFoundError extends AppError {
  /**
   * path 是公开本机 API 路径，不包含用户磁盘或密钥信息。
   */
  public constructor(path: string) {
    super({
      code: "request.route_not_found",
      public_details: { path },
      diagnostic_context: { path },
    });
  }
}
