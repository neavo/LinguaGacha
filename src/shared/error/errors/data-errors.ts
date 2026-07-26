import { AppError, type AppErrorArgs } from "../app-error";

/**
 * 跨 API 写入的 section revision 冲突，公开 details 可承载安全版本字段。
 */
export class RevisionConflictError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "data.revision_conflict", ...args });
  }
}

/**
 * 可恢复的数据库写入冲突，底层 SQLite 信息只通过 cause 留给日志。
 */
export class DatabaseConflictError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "database.conflict", ...args });
  }
}
