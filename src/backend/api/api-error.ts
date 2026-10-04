import path from "node:path";

import {
  AppError,
  type AppErrorPublicDetails,
  is_app_error,
  to_api_error_payload,
} from "../../shared/error";
import { api_error } from "./api-types";

/**
 * API 错误归一为 AppError，保留具体原因；堆栈和诊断对象由日志保存。
 */
export function normalize_api_error(error: unknown): AppError {
  if (is_app_error(error)) {
    return error;
  }
  if (error instanceof SyntaxError) {
    return new AppError("request.invalid_json", { cause: error });
  }
  const node_code = read_node_error_code(error);
  if (node_code === "ENOENT") {
    return new AppError("file.not_found", {
      public_details: safe_path_detail(error),
      cause: error,
    });
  }
  return new AppError("runtime.internal_invariant", { cause: error });
}

/**
 * 响应壳包含稳定错误码、原因和公开详情；request_id 用于服务端日志关联。
 */
export function api_error_envelope(error: AppError) {
  return api_error(to_api_error_payload(error));
}

/** 文件错误按 Node 错误码归类，原始原因随 cause 保留。 */
function read_node_error_code(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

/** 公开文件定位使用末段名称，完整路径由原始异常提供。 */
function safe_path_detail(error: unknown): AppErrorPublicDetails {
  const candidate =
    typeof error === "object" && error !== null && "path" in error ? String(error.path ?? "") : "";
  return candidate === "" ? {} : { filename: path.basename(candidate) };
}
