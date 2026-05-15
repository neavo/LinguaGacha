import type { AppErrorCode, AppErrorDetails } from "./api-error";

export type ApiJsonValue =
  | null
  | boolean
  | number
  | string
  | ApiJsonValue[]
  | { [key: string]: ApiJsonValue };

export interface ApiSuccessEnvelope {
  ok: true;
  data: ApiJsonValue;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: {
    code: AppErrorCode;
    message: string;
    safe_message: string;
    message_key: `app.error.${AppErrorCode}`;
    details?: AppErrorDetails;
    action?: string;
    request_id: string;
  };
}

export type ApiEnvelope = ApiSuccessEnvelope | ApiErrorEnvelope;

export interface ApiGatewayStartResult {
  baseUrl: string;
}

export function ok(data: ApiJsonValue): ApiSuccessEnvelope {
  return { ok: true, data };
}

export function api_error(args: ApiErrorEnvelope["error"]): ApiErrorEnvelope {
  return { ok: false, error: args };
}
