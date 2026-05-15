import type { ApiErrorPayload, ApiJsonValue, ApiSuccessEnvelope } from "../../shared/error";

export type { ApiJsonValue, ApiSuccessEnvelope } from "../../shared/error";

export interface ApiErrorEnvelope {
  ok: false;
  error: ApiErrorPayload;
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
