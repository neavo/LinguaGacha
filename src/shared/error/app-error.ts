import type { LocaleKey } from "../i18n";
import type { JsonRecord, JsonValue } from "../../domain/json";

type AppErrorSeverity = "expected" | "warning" | "fault";

export type AppErrorPublicDetails = JsonRecord;
export type AppErrorDiagnosticContext = Record<string, unknown>;

export interface AppErrorDefinition {
  status: 400 | 404 | 409 | 415 | 423 | 500 | 502;
  severity: AppErrorSeverity;
}

// 稳定错误码只由定义表键拥有，调用点不得再建立类名或并行词表。
export const APP_ERROR_DEFINITIONS = {
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
  },
  "project.not_found": {
    status: 404,
    severity: "expected",
  },
  "file.not_found": {
    status: 404,
    severity: "expected",
  },
  "file.parse_failed": {
    status: 415,
    severity: "expected",
  },
  "file.invalid_structure": {
    status: 415,
    severity: "expected",
  },
  "file.io_failed": {
    status: 500,
    severity: "fault",
  },
  "database.conflict": {
    status: 409,
    severity: "expected",
  },
  "data.revision_conflict": {
    status: 409,
    severity: "expected",
  },
  "data.committed_sync_failed": {
    status: 500,
    severity: "fault",
  },
  "runtime.busy": {
    status: 423,
    severity: "expected",
  },
  "model.not_found": {
    status: 404,
    severity: "expected",
  },
  "model.provider_failed": {
    status: 502,
    severity: "warning",
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
} as const satisfies Readonly<Record<string, AppErrorDefinition>>;

export type AppErrorCode = keyof typeof APP_ERROR_DEFINITIONS;
export type AppErrorMessageKey = Extract<LocaleKey, `app.error.${AppErrorCode}.message`>;

interface AppErrorOptions {
  public_details?: AppErrorPublicDetails;
  diagnostic_context?: AppErrorDiagnosticContext;
  cause?: unknown;
}

/**
 * AppError 是跨 main / renderer / worker 的唯一错误事实，不承担日志写入副作用。
 */
export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly severity: AppErrorSeverity;
  public readonly public_details: AppErrorPublicDetails;
  public readonly diagnostic_context: AppErrorDiagnosticContext;

  /**
   * 构造时只冻结错误事实，HTTP 和日志快照由独立纯函数完成。
   */
  public constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    const definition = APP_ERROR_DEFINITIONS[code];
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.severity = definition.severity;
    this.public_details = sanitize_app_error_public_details(options.public_details ?? {});
    this.diagnostic_context = { ...options.diagnostic_context };
  }
}

/** 用户可见错误文案只从稳定 code 推导，不保存第二份 message key 事实。 */
export function app_error_message_key(code: AppErrorCode): AppErrorMessageKey {
  return `app.error.${code}.message` as AppErrorMessageKey;
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
