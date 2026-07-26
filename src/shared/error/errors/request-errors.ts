import { AppError, type AppErrorArgs } from "../app-error";

/** API 或服务入口的参数校验失败，只按稳定 code 对外分支。 */
export class RequestValidationError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "request.validation_failed", ...args });
  }
}

/** 请求体 JSON 解析失败，原始语法异常只保留为 cause。 */
export class InvalidJsonError extends AppError {
  public constructor(cause?: unknown) {
    super({ code: "request.invalid_json", cause });
  }
}

/** 本机 API 路径未注册，公开 path 不包含用户磁盘信息。 */
export class RouteNotFoundError extends AppError {
  public constructor(path: string) {
    super({
      code: "request.route_not_found",
      public_details: { path },
      diagnostic_context: { path },
    });
  }
}
