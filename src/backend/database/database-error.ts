import { AppError, is_app_error, summarize_log_error_path } from "../../shared/error";

const SQLITE_PRIMARY_CODE_MASK = 0xff; // SQLite 扩展码的低八位保存主错误码。
const SQLITE_BUSY = 5; // SQLite 协议定义的外部连接竞争。

/** 在存储边界解释 SQLite 数值码，保留原始原因并返回公开错误码。 */
export function database_error(error: unknown, project_path: string, operation: string): AppError {
  if (is_app_error(error)) return error;
  const sqlite_code =
    error instanceof Error && "errcode" in error && typeof error.errcode === "number"
      ? error.errcode
      : undefined;
  return new AppError(
    sqlite_code !== undefined && (sqlite_code & SQLITE_PRIMARY_CODE_MASK) === SQLITE_BUSY
      ? "database.busy"
      : "runtime.internal_invariant",
    {
      cause: error,
      diagnostic_context: {
        operation,
        project: summarize_log_error_path(project_path),
        ...(sqlite_code === undefined ? {} : { sqlite_code }),
      },
    },
  );
}

/** 收尾失败同时保留两个异常，并按基础设施故障上报。 */
export function database_cleanup_error(error: unknown, cleanup: unknown): AppError {
  return new AppError("runtime.internal_invariant", {
    cause: new AggregateError([error, cleanup], "Database operation and cleanup failed."),
    diagnostic_context: { operation: "cleanup", cleanup_failed: true },
  });
}
