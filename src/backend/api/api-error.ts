import path from "node:path";

import {
  FileNotFoundError,
  InternalInvariantError,
  InvalidJsonError,
  type AppError,
  type AppErrorPublicDetails,
  is_app_error,
  to_api_error_payload,
} from "../../shared/error";
import type { TextResolver } from "../../shared/i18n";
import { api_error } from "./api-types";

/**
 * API 错误只映射为公开 AppError，底层异常、栈和敏感路径不会进入响应壳。
 */
export function normalize_api_error(error: unknown): AppError {
  if (is_app_error(error)) {
    return error;
  }
  if (error instanceof SyntaxError) {
    return new InvalidJsonError(error);
  }
  const node_code = read_node_error_code(error);
  if (node_code === "ENOENT") {
    return new FileNotFoundError({
      public_details: safe_path_detail(error),
      cause: error,
    });
  }
  return InternalInvariantError.from_unknown(error);
}

/**
 * 响应壳只包含安全字段，request_id 用于 UI 和日志对齐诊断。
 */
export function api_error_envelope(error: AppError, request_id: string, text: TextResolver) {
  return api_error(to_api_error_payload(error, request_id, text));
}

function read_node_error_code(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function safe_path_detail(error: unknown): AppErrorPublicDetails {
  const candidate =
    typeof error === "object" && error !== null && "path" in error ? String(error.path ?? "") : "";
  return candidate === "" ? {} : { filename: path.basename(candidate) };
}
