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
    code: "not_found" | "invalid_request" | "internal_error";
    message: string;
  };
}

export type ApiEnvelope = ApiSuccessEnvelope | ApiErrorEnvelope;

export interface ApiGatewayStartResult {
  baseUrl: string;
  instanceToken: string;
}

export function ok(data: ApiJsonValue): ApiSuccessEnvelope {
  return { ok: true, data };
}

export function api_error(
  code: ApiErrorEnvelope["error"]["code"],
  message: string,
): ApiErrorEnvelope {
  return { ok: false, error: { code, message } };
}
