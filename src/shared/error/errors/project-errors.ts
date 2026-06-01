import { AppError, type AppErrorArgs } from "../app-error";

/**
 * ProjectNotLoadedError 表示当前 Backend 会话没有 loaded 工程。
 */
export class ProjectNotLoadedError extends AppError {
  /**
   * 该错误不接收动态文案，避免工程加载态分支在调用点发散。
   */
  public constructor() {
    super({ code: "project.not_loaded" });
  }
}

/**
 * ProjectNotFoundError 只暴露安全文件名，完整路径留在诊断日志。
 */
export class ProjectNotFoundError extends AppError {
  /**
   * public_details 由调用方传入前先裁剪为 filename 等安全字段。
   */
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "project.not_found", ...args });
  }
}
