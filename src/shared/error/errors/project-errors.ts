import { AppError, type AppErrorArgs } from "../app-error";

/** 当前 Backend 会话没有 loaded 工程。 */
export class ProjectNotLoadedError extends AppError {
  public constructor() {
    super({ code: "project.not_loaded" });
  }
}

/** 工程文件不存在，公开 details 只能携带安全文件名。 */
export class ProjectNotFoundError extends AppError {
  public constructor(args: AppErrorArgs = {}) {
    super({ code: "project.not_found", ...args });
  }
}
