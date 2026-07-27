import type { JsonValue } from "../../domain/json";
import type { ApiErrorEnvelope, ApiSuccessEnvelope } from "../../shared/error";

export type { ApiEnvelope, ApiErrorEnvelope, ApiSuccessEnvelope } from "../../shared/error";

export interface ApiGatewayStartResult {
  baseUrl: string;
}

export function ok(data: JsonValue): ApiSuccessEnvelope {
  return { ok: true, data };
}

export function api_error(args: ApiErrorEnvelope["error"]): ApiErrorEnvelope {
  return { ok: false, error: args };
}
