import {
  APP_ERROR_DEFINITIONS,
  type AppError,
  type AppErrorCode,
  type AppErrorDefinition,
  type AppErrorPublicDetails,
} from "./app-error";
import type { JsonValue } from "../../domain/json";

export interface ApiErrorPayload {
  code: AppErrorCode;
  details?: AppErrorPublicDetails;
}

export type ApiErrorEnvelope = {
  ok: false;
  error: ApiErrorPayload;
};

export type ApiSuccessEnvelope = {
  ok: true;
  data: JsonValue;
};

export type ApiEnvelope = ApiSuccessEnvelope | ApiErrorEnvelope;

/**
 * API 公开形状只暴露安全字段，诊断上下文和 cause 链只能进入日志。
 */
export function to_api_error_payload(error: AppError): ApiErrorPayload {
  return {
    code: error.code,
    ...(Object.keys(error.public_details).length > 0 ? { details: error.public_details } : {}),
  };
}

// Hono 响应层只消费这里返回的公开 HTTP 状态，业务层不直接判断 code。
export function resolve_app_error_http_status(error: AppError): AppErrorDefinition["status"] {
  return APP_ERROR_DEFINITIONS[error.code].status;
}
