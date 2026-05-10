// Database JSON 契约只允许可跨 HTTP 边界稳定序列化的值。
export type DatabaseJsonValue =
  | null
  | boolean
  | number
  | string
  | DatabaseJsonValue[]
  | { [key: string]: DatabaseJsonValue };

export interface DatabaseOperation {
  // 操作名由 TS 服务固定发出，database 层集中分发和校验。
  name: string;
  args?: Record<string, DatabaseJsonValue>;
}

export interface DatabaseSuccessEnvelope {
  ok: true;
  data: DatabaseJsonValue;
}

export interface DatabaseErrorEnvelope {
  ok: false;
  error: {
    code: "invalid_request" | "database_conflict" | "io_error" | "internal_error";
    message: string;
  };
}

export type DatabaseEnvelope = DatabaseSuccessEnvelope | DatabaseErrorEnvelope;
