import { AppError, type AppErrorArgs } from "../app-error";

/**
 * RevisionConflictError 是跨 API 写入的版本冲突语义。
 */
export class RevisionConflictError extends AppError {
  /**
   * section/current/expected 等安全字段放入 public_details 供页面重试提示使用。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "data.revision_conflict", ...args });
  }
}

/**
 * DatabaseConflictError 表示可恢复的数据库写入冲突。
 */
export class DatabaseConflictError extends AppError {
  /**
   * 数据库层只给出安全 details，底层 SQLite 细节只作为 cause。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "database.conflict", ...args });
  }
}
