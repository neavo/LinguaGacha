import type { JsonRecord, JsonValue } from "../../domain/json";

type AppErrorSeverity = "expected" | "warning" | "fault";

export type AppErrorPublicDetails = JsonRecord;
export type AppErrorDiagnosticContext = Record<string, unknown>;

export interface AppErrorDefinition {
  status: 400 | 404 | 409 | 415 | 423 | 500 | 502;
  severity: AppErrorSeverity;
  message: string; // 无底层异常时使用的源头原因。
}

// 稳定错误码只由定义表键拥有，调用点不得再建立类名或并行词表。
export const APP_ERROR_DEFINITIONS = {
  "request.validation_failed": {
    message: "The request parameters are invalid.",
    status: 400,
    severity: "expected",
  },
  "request.invalid_json": {
    message: "The request JSON is invalid.",
    status: 400,
    severity: "expected",
  },
  "request.route_not_found": {
    message: "The API route does not exist.",
    status: 404,
    severity: "expected",
  },
  "project.not_loaded": { message: "No project is loaded.", status: 409, severity: "expected" },
  "project.not_found": {
    message: "The project file does not exist.",
    status: 404,
    severity: "expected",
  },
  "translation.generation_failed": {
    message: "Translation file generation failed.",
    status: 500,
    severity: "fault",
  },
  "file.not_found": { message: "The file does not exist.", status: 404, severity: "expected" },
  "file.preview_too_large": {
    message: "The file exceeds the preview size limit.",
    status: 415,
    severity: "expected",
  },
  "file.already_exists": {
    message: "A file or folder with this name already exists.",
    status: 409,
    severity: "expected",
  },
  "file.parse_failed": {
    message: "File content parsing failed.",
    status: 415,
    severity: "expected",
  },
  "file.invalid_structure": {
    message: "The file structure does not match the expected format.",
    status: 415,
    severity: "expected",
  },
  "file.io_failed": { message: "File read or write failed.", status: 500, severity: "fault" },
  "database.conflict": { message: "Database write conflict.", status: 409, severity: "expected" },
  "database.busy": { message: "The project database is busy.", status: 423, severity: "warning" },
  "project.already_exists": {
    message: "The project file already exists.",
    status: 409,
    severity: "expected",
  },
  "data.revision_conflict": {
    message: "The data was modified by another operation.",
    status: 409,
    severity: "expected",
  },
  "data.committed_sync_failed": {
    message: "Data was saved, but subsequent synchronization failed.",
    status: 500,
    severity: "fault",
  },
  "runtime.busy": {
    message: "The runtime is occupied by another operation.",
    status: 423,
    severity: "expected",
  },
  "model.not_found": {
    message: "The model configuration does not exist.",
    status: 404,
    severity: "expected",
  },
  "model.provider_failed": {
    message: "The model service request failed.",
    status: 502,
    severity: "warning",
  },
  "model.auth_required": {
    message: "Account sign-in is required.",
    status: 409,
    severity: "expected",
  },
  "worker.failed": {
    message: "The background execution channel failed.",
    status: 502,
    severity: "warning",
  },
  "worker.execution_failed": {
    message: "The background task failed.",
    status: 502,
    severity: "warning",
  },
  "runtime.capability_missing": {
    message: "A required runtime capability is missing.",
    status: 500,
    severity: "fault",
  },
  "runtime.disposed": {
    message: "The runtime resource has been disposed.",
    status: 500,
    severity: "fault",
  },
  "runtime.cancelled": {
    message: "The operation was cancelled.",
    status: 409,
    severity: "expected",
  },
  "runtime.internal_invariant": {
    message: "Internal state error.",
    status: 500,
    severity: "fault",
  },
  "language.invalid_target_language": {
    message: "The target language is invalid.",
    status: 400,
    severity: "expected",
  },
  "language.unsupported_all_target_language": {
    message: "The target language cannot be All.",
    status: 400,
    severity: "expected",
  },
  "language.unknown_source_language_code": {
    message: "The source language code is invalid.",
    status: 400,
    severity: "expected",
  },
  "quality.unknown_rule_type": {
    message: "The quality rule type is invalid.",
    status: 400,
    severity: "expected",
  },
  "quality.unsupported_rule_meta": {
    message: "The quality rule setting is invalid.",
    status: 400,
    severity: "expected",
  },
  "prompt.unknown_prompt_type": {
    message: "The prompt type is invalid.",
    status: 400,
    severity: "expected",
  },
} as const satisfies Readonly<Record<string, AppErrorDefinition>>;

export type AppErrorCode = keyof typeof APP_ERROR_DEFINITIONS;

interface AppErrorOptions {
  message?: string; // 包装者可补充本次失败的具体上下文。
  public_details?: AppErrorPublicDetails;
  diagnostic_context?: AppErrorDiagnosticContext;
  cause?: unknown;
}

/**
 * AppError 是跨 main / renderer / worker 的唯一错误事实，不承担日志写入副作用。
 */
export class AppError extends Error {
  public readonly code: AppErrorCode; // 跨层传递的稳定业务错误码。
  public readonly severity: AppErrorSeverity; // 从错误定义表取得的严重度。
  public readonly public_details: AppErrorPublicDetails; // 随 API 响应返回的公开详情。
  public readonly diagnostic_context: AppErrorDiagnosticContext; // 随服务端日志保存的诊断字段。

  /**
   * 构造时只冻结错误事实，HTTP 和日志快照由独立纯函数完成。
   */
  public constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    const definition = APP_ERROR_DEFINITIONS[code];
    super(
      options.message?.trim() || read_error_message(options.cause, definition.message),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = code;
    this.severity = definition.severity;
    this.public_details = sanitize_app_error_public_details(options.public_details ?? {});
    this.diagnostic_context = { ...options.diagnostic_context };
  }
}

/** 只提取异常本身的原因；包装者负责选择原因，不遍历 cause 链。 */
export function read_error_message(
  error: unknown,
  fallback = "No error details were provided.",
): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim() || fallback;
}

/** 动态载荷只接受定义表已声明的稳定错误码。 */
export function is_app_error_code(value: unknown): value is AppErrorCode {
  return typeof value === "string" && Object.hasOwn(APP_ERROR_DEFINITIONS, value);
}

// 跨 realm 不做结构猜测，只有统一基类实例才属于受控应用错误。
export function is_app_error(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * 公开 details 只能保留 JSON 值，防止 Error、stack 或复杂对象穿过 API 边界。
 */
function sanitize_app_error_public_details(details: AppErrorPublicDetails): AppErrorPublicDetails {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => is_safe_json_value(value)),
  );
}

/** 递归筛选公开详情允许的基础值、数组和对象。 */
function is_safe_json_value(value: JsonValue): boolean {
  if (value === null) {
    return true;
  }
  if (["boolean", "number", "string"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => is_safe_json_value(item));
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every((item) => is_safe_json_value(item));
}
