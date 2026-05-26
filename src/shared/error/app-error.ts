import type { LocaleKey } from "../i18n";

export type ApiJsonValue =
  | null
  | boolean
  | number
  | string
  | ApiJsonValue[]
  | { [key: string]: ApiJsonValue };

export type AppErrorSeverity = "expected" | "warning" | "fault";

// AppErrorCode 是跨 API、renderer 和日志的稳定语义码，禁止按调用点另建词表。
export type AppErrorCode =
  | "request.validation_failed"
  | "request.invalid_json"
  | "request.route_not_found"
  | "project.not_loaded"
  | "project.not_found"
  | "file.not_found"
  | "file.unsupported_format"
  | "file.parse_failed"
  | "file.invalid_structure"
  | "file.io_failed"
  | "database.conflict"
  | "data.revision_conflict"
  | "task.busy"
  | "model.not_found"
  | "model.provider_failed"
  | "worker.failed"
  | "worker.execution_failed"
  | "runtime.capability_missing"
  | "runtime.disposed"
  | "runtime.cancelled"
  | "runtime.internal_invariant"
  | "language.invalid_target_language"
  | "language.unsupported_all_target_language"
  | "language.unknown_source_language_code"
  | "quality.unknown_rule_type"
  | "quality.unsupported_rule_meta"
  | "prompt.unknown_prompt_type";

export type AppErrorPublicDetails = Record<string, ApiJsonValue>;
export type AppErrorDiagnosticContext = Record<string, unknown>;
export type AppErrorMessageKey = Extract<LocaleKey, `app.error.${AppErrorCode}.message`>;
export type AppErrorActionKey = Extract<LocaleKey, `app.error.${AppErrorCode}.action`>;

export interface AppErrorDefinition {
  status: 400 | 404 | 409 | 415 | 423 | 500 | 502;
  severity: AppErrorSeverity;
  action_key?: AppErrorActionKey;
}

// 定义表只保存协议和投影策略，用户可见文案统一由 i18n 资源解析。
export const APP_ERROR_DEFINITIONS: Readonly<Record<AppErrorCode, AppErrorDefinition>> = {
  "request.validation_failed": {
    status: 400,
    severity: "expected",
  },
  "request.invalid_json": {
    status: 400,
    severity: "expected",
  },
  "request.route_not_found": {
    status: 404,
    severity: "expected",
  },
  "project.not_loaded": {
    status: 409,
    severity: "expected",
    action_key: "app.error.project.not_loaded.action",
  },
  "project.not_found": {
    status: 404,
    severity: "expected",
    action_key: "app.error.project.not_found.action",
  },
  "file.not_found": {
    status: 404,
    severity: "expected",
    action_key: "app.error.file.not_found.action",
  },
  "file.unsupported_format": {
    status: 415,
    severity: "expected",
    action_key: "app.error.file.unsupported_format.action",
  },
  "file.parse_failed": {
    status: 415,
    severity: "expected",
    action_key: "app.error.file.parse_failed.action",
  },
  "file.invalid_structure": {
    status: 415,
    severity: "expected",
    action_key: "app.error.file.invalid_structure.action",
  },
  "file.io_failed": {
    status: 500,
    severity: "fault",
  },
  "database.conflict": {
    status: 409,
    severity: "expected",
    action_key: "app.error.database.conflict.action",
  },
  "data.revision_conflict": {
    status: 409,
    severity: "expected",
    action_key: "app.error.data.revision_conflict.action",
  },
  "task.busy": {
    status: 423,
    severity: "expected",
    action_key: "app.error.task.busy.action",
  },
  "model.not_found": {
    status: 404,
    severity: "expected",
    action_key: "app.error.model.not_found.action",
  },
  "model.provider_failed": {
    status: 502,
    severity: "warning",
    action_key: "app.error.model.provider_failed.action",
  },
  "worker.failed": {
    status: 502,
    severity: "warning",
  },
  "worker.execution_failed": {
    status: 502,
    severity: "warning",
  },
  "runtime.capability_missing": {
    status: 500,
    severity: "fault",
  },
  "runtime.disposed": {
    status: 500,
    severity: "fault",
  },
  "runtime.cancelled": {
    status: 409,
    severity: "expected",
  },
  "runtime.internal_invariant": {
    status: 500,
    severity: "fault",
  },
  "language.invalid_target_language": {
    status: 400,
    severity: "expected",
  },
  "language.unsupported_all_target_language": {
    status: 400,
    severity: "expected",
  },
  "language.unknown_source_language_code": {
    status: 400,
    severity: "expected",
  },
  "quality.unknown_rule_type": {
    status: 400,
    severity: "expected",
  },
  "quality.unsupported_rule_meta": {
    status: 400,
    severity: "expected",
  },
  "prompt.unknown_prompt_type": {
    status: 400,
    severity: "expected",
  },
};

export interface AppErrorOptions {
  code: AppErrorCode;
  public_details?: AppErrorPublicDetails;
  diagnostic_context?: AppErrorDiagnosticContext;
  cause?: unknown;
}

export type AppErrorArgs = Omit<AppErrorOptions, "code">;

/**
 * AppError 是跨 main / renderer / worker 的唯一错误事实，不承担日志写入副作用。
 */
export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly severity: AppErrorSeverity;
  public readonly message_key: AppErrorMessageKey;
  public readonly action_key?: AppErrorActionKey;
  public readonly public_details: AppErrorPublicDetails;
  public readonly diagnostic_context: AppErrorDiagnosticContext;

  /**
   * 构造时只冻结错误事实，HTTP 和日志投影由独立纯函数完成。
   */
  public constructor(options: AppErrorOptions) {
    const definition = APP_ERROR_DEFINITIONS[options.code];
    super(options.code, options.cause === undefined ? undefined : { cause: options.cause });
    if (options.cause !== undefined && this.cause === undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        configurable: true,
        writable: true,
      });
    }
    this.name = new.target.name;
    this.code = options.code;
    this.severity = definition.severity;
    this.message_key = build_app_error_message_key(options.code);
    this.action_key = definition.action_key;
    this.public_details = sanitize_app_error_public_details(options.public_details ?? {});
    this.diagnostic_context = { ...options.diagnostic_context };
  }
}

export function is_app_error(error: unknown): error is AppError {
  return error instanceof AppError;
}

// 读取定义时集中收口，避免 API / 日志投影直接触碰定义表形状。
export function get_app_error_definition(code: AppErrorCode): AppErrorDefinition {
  return APP_ERROR_DEFINITIONS[code];
}

export function build_app_error_message_key(code: AppErrorCode): AppErrorMessageKey {
  return `app.error.${code}.message` as AppErrorMessageKey;
}

/**
 * 公开 details 只能保留 JSON 值，防止 Error、stack 或复杂对象穿过 API 边界。
 */
function sanitize_app_error_public_details(details: AppErrorPublicDetails): AppErrorPublicDetails {
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
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every((item) => is_safe_api_json_value(item));
}
