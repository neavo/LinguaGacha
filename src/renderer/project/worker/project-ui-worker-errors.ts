import type { LogError } from "@shared/error";

export type ProjectUiWorkerClientErrorCode =
  | "unsupported"
  | "init_failed"
  | "execution_failed"
  | "disposed"
  | "stale";

// PROJECT UI WORKER ERROR MESSAGE BY CODE 是模块级稳定契约，集中维护避免调用点散落魔术值。
const PROJECT_UI_WORKER_ERROR_MESSAGE_BY_CODE: Readonly<
  Record<ProjectUiWorkerClientErrorCode, string>
> = {
  unsupported: "project_ui_worker_unsupported",
  init_failed: "project_ui_worker_init_failed",
  execution_failed: "project_ui_worker_execution_failed",
  disposed: "project_ui_worker_disposed",
  stale: "project_ui_worker_stale",
};

// ProjectUiWorkerClientError 收口当前模块的状态和副作用边界，避免调用方分散维护同一流程。
export class ProjectUiWorkerClientError extends Error {
  public readonly code: ProjectUiWorkerClientErrorCode; // code 是页面判断 worker 边界错误的唯一稳定事实
  public readonly log_error?: LogError; // log_error 只供调试日志和测试观察，不进入页面分支

  /**
   * Project UI Worker 错误只暴露稳定 code，message 保留给非展示诊断。
   */
  public constructor(code: ProjectUiWorkerClientErrorCode, log_error?: LogError) {
    super(PROJECT_UI_WORKER_ERROR_MESSAGE_BY_CODE[code]);
    this.name = "ProjectUiWorkerClientError";
    this.code = code;
    this.log_error = log_error;
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
