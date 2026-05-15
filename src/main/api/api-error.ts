import type { ApiJsonValue } from "./api-types";

export type AppErrorCode =
  | "validation_failed"
  | "route_not_found"
  | "project_not_loaded"
  | "project_not_found"
  | "file_not_found"
  | "revision_conflict"
  | "task_busy"
  | "unsupported_file_format"
  | "file_io_failed"
  | "database_conflict"
  | "model_not_found"
  | "model_provider_failed"
  | "worker_failed"
  | "runtime_capability_missing"
  | "internal_invariant";

export type AppErrorSeverity = "expected" | "warning" | "fault";

export type AppErrorDetails = Record<string, ApiJsonValue>;

type AppErrorHttpStatus = 400 | 404 | 409 | 415 | 423 | 500 | 502;

interface AppErrorDefinition {
  status: AppErrorHttpStatus; // status 是 Gateway 唯一 HTTP 映射来源，避免路由层重复判断 code
  severity: AppErrorSeverity; // severity 只服务日志分级，不进入 UI 决策
  message: string; // message 是无上下文时可安全展示的中文默认文案
  action?: string; // action 给 renderer 做通用提示，具体页面仍可按 code 细化
}

export const APP_ERROR_DEFINITIONS: Readonly<Record<AppErrorCode, AppErrorDefinition>> = {
  validation_failed: {
    status: 400,
    severity: "expected",
    message: "请求参数无效。",
  },
  route_not_found: {
    status: 404,
    severity: "expected",
    message: "API 路由不存在。",
  },
  project_not_loaded: {
    status: 409,
    severity: "expected",
    message: "工程未加载。",
    action: "请先打开或创建工程。",
  },
  project_not_found: {
    status: 404,
    severity: "expected",
    message: "工程文件不存在。",
    action: "请确认工程文件仍在原位置。",
  },
  file_not_found: {
    status: 404,
    severity: "expected",
    message: "文件不存在。",
    action: "请确认文件仍在原位置。",
  },
  revision_conflict: {
    status: 409,
    severity: "expected",
    message: "数据版本已变化，请刷新后重试。",
    action: "请刷新当前数据后再次提交。",
  },
  task_busy: {
    status: 423,
    severity: "expected",
    message: "后台任务正在执行中，请稍后再试。",
    action: "请等待当前任务结束或先停止任务。",
  },
  unsupported_file_format: {
    status: 415,
    severity: "expected",
    message: "不支持的文件格式。",
    action: "请选择 LinguaGacha 支持的源文件。",
  },
  file_io_failed: {
    status: 500,
    severity: "fault",
    message: "文件读写失败。",
  },
  database_conflict: {
    status: 409,
    severity: "expected",
    message: "数据库写入冲突，请刷新后重试。",
    action: "请刷新当前数据后再次提交。",
  },
  model_not_found: {
    status: 404,
    severity: "expected",
    message: "模型配置不存在。",
    action: "请重新选择模型配置。",
  },
  model_provider_failed: {
    status: 502,
    severity: "warning",
    message: "模型服务请求失败，请检查接口配置。",
    action: "请检查模型地址、密钥和服务商状态。",
  },
  worker_failed: {
    status: 502,
    severity: "warning",
    message: "后台执行通道失败。",
  },
  runtime_capability_missing: {
    status: 500,
    severity: "fault",
    message: "当前运行环境缺少必要能力。",
  },
  internal_invariant: {
    status: 500,
    severity: "fault",
    message: "内部状态异常。",
  },
};

interface AppErrorOptions {
  code: AppErrorCode; // code 是跨 main / renderer 的稳定分支依据
  message?: string;
  details?: AppErrorDetails;
  cause?: unknown;
}

/**
 * AppError 是 main 进程公开失败的唯一业务错误载体
 */
export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly status: AppErrorHttpStatus;
  public readonly severity: AppErrorSeverity;
  public readonly safe_message: string;
  public readonly message_key: `app.error.${AppErrorCode}`;
  public readonly details: AppErrorDetails;
  public readonly action?: string;

  /**
   * 从稳定 code 派生 HTTP、文案和日志分级，避免服务层手写响应壳
   */
  public constructor(options: AppErrorOptions) {
    const definition = APP_ERROR_DEFINITIONS[options.code];
    const safe_message = options.message ?? definition.message;
    super(safe_message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.status = definition.status;
    this.severity = definition.severity;
    this.safe_message = safe_message;
    this.message_key = `app.error.${options.code}`;
    this.details = sanitize_app_error_details(options.details ?? {});
    this.action = definition.action;
  }
}

export function app_error(
  code: AppErrorCode,
  message?: string,
  details?: AppErrorDetails,
  cause?: unknown,
): AppError {
  return new AppError({ code, message, details, cause });
}

export function is_app_error(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * details 只允许安全 JSON 字段，避免 Error、stack 或复杂对象穿过公开协议
 */
function sanitize_app_error_details(details: AppErrorDetails): AppErrorDetails {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => is_safe_api_json_value(value)),
  );
}

function is_safe_api_json_value(value: ApiJsonValue): boolean {
  if (value === null) {
    return true;
  }
  if (["boolean", "number", "string"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => is_safe_api_json_value(item));
  }
  return Object.values(value).every((item) => is_safe_api_json_value(item));
}
