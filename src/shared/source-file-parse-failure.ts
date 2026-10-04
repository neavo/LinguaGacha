import { is_app_error_code, type AppErrorCode } from "./error/app-error";

export type SourceFileParseFailureRecord = {
  source_path: string; // 保留真实源路径，日志和调试需要定位原文件
  rel_path: string; // 工程或工作台内的目标相对路径，无法确定时为空串
  filename: string; // Toast 可见定位，不把完整路径塞进页面提示
  code: AppErrorCode; // 机器分类。
  message: string; // 解析源头保留的具体原因。
};

/**
 * 收窄后端返回的失败文件列表，避免页面直接信任 API 动态载荷。
 */
export function normalize_source_file_parse_failures(
  value: unknown,
): SourceFileParseFailureRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const failure = normalize_source_file_parse_failure(item);
    return failure === null ? [] : [failure];
  });
}

/**
 * Toast 与日志共用完整逐文件原因，便于定位批量操作中的失败文件。
 */
export function format_source_file_parse_failure_notice(
  failures: readonly SourceFileParseFailureRecord[],
): string {
  return failures.map((failure) => `${failure.filename} - ${failure.message}`).join("\n");
}

/**
 * 文件名、有效错误码和具体原因共同构成可展示的失败记录。
 */
function normalize_source_file_parse_failure(value: unknown): SourceFileParseFailureRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const filename = String(record["filename"] ?? "").trim();
  const code = String(record["code"] ?? "").trim();
  const source_path = String(record["source_path"] ?? "").trim();
  const rel_path = String(record["rel_path"] ?? "").trim();
  const message = typeof record["message"] === "string" ? record["message"].trim() : "";
  if (filename === "" || !is_app_error_code(code) || message === "") {
    return null;
  }
  return {
    source_path,
    rel_path,
    filename,
    code,
    message,
  };
}
