export type ProjectUiWorkerClientErrorCode =
  | "unsupported"
  | "init_failed"
  | "execution_failed"
  | "disposed"
  | "stale";

const PROJECT_UI_WORKER_ERROR_MESSAGE_BY_CODE: Readonly<
  Record<ProjectUiWorkerClientErrorCode, string>
> = {
  unsupported: "project_ui_worker_unsupported",
  init_failed: "project_ui_worker_init_failed",
  execution_failed: "project_ui_worker_execution_failed",
  disposed: "project_ui_worker_disposed",
  stale: "project_ui_worker_stale",
};

export class ProjectUiWorkerClientError extends Error {
  public readonly code: ProjectUiWorkerClientErrorCode; // code 是页面判断 worker 边界错误的唯一稳定事实

  /**
   * Project UI Worker 错误只暴露稳定 code，message 保留给非展示诊断。
   */
  public constructor(code: ProjectUiWorkerClientErrorCode) {
    super(PROJECT_UI_WORKER_ERROR_MESSAGE_BY_CODE[code]);
    this.name = "ProjectUiWorkerClientError";
    this.code = code;
  }
}

/**
 * 收窄 Project UI Worker 边界错误；页面只依赖稳定 code，不解析 message。
 */
export function is_project_ui_worker_client_error(
  error: unknown,
  code?: ProjectUiWorkerClientErrorCode,
): error is ProjectUiWorkerClientError {
  if (!(error instanceof ProjectUiWorkerClientError)) {
    return false;
  }

  return code === undefined || error.code === code;
}
