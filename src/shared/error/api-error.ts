import {
  get_app_error_definition,
  type ApiJsonValue,
  type AppError,
  type AppErrorActionKey,
  type AppErrorCode,
  type AppErrorDefinition,
  type AppErrorMessageKey,
  type AppErrorPublicDetails,
} from "./app-error";
import type { TextResolver } from "../i18n";

export interface ApiErrorPayload {
  code: AppErrorCode;
  message: string;
  message_key: AppErrorMessageKey;
  action_key?: AppErrorActionKey;
  details?: AppErrorPublicDetails;
  action?: string;
  request_id: string;
}

export type ApiErrorEnvelope = {
  ok: false;
  error: ApiErrorPayload;
};

export type ApiSuccessEnvelope = {
  ok: true;
  data: ApiJsonValue;
};

export type ApiEnvelope = ApiSuccessEnvelope | ApiErrorEnvelope;

/**
 * API 投影只暴露安全字段，诊断上下文和 cause 链只能进入日志。
 */
export function to_api_error_payload(
  error: AppError,
  request_id: string,
  text: TextResolver,
): ApiErrorPayload {
  const message_params = public_details_to_i18n_params(error.public_details);
  const message = text(error.message_key, message_params);
  return {
    code: error.code,
    message,
    message_key: error.message_key,
    ...(Object.keys(error.public_details).length > 0 ? { details: error.public_details } : {}),
    ...(error.action_key === undefined
      ? {}
      : { action: text(error.action_key, message_params), action_key: error.action_key }),
    request_id,
  };
}

// Hono 响应层只消费这里返回的公开 HTTP 状态，业务层不直接判断 code。
export function resolve_app_error_http_status(error: AppError): AppErrorDefinition["status"] {
  return get_app_error_definition(error.code).status;
}

function public_details_to_i18n_params(details: AppErrorPublicDetails): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key.toUpperCase(), api_json_to_string(value)]),
  );
}

function api_json_to_string(value: ApiJsonValue): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
