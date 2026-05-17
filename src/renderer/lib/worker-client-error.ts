export type WorkerClientErrorCode =
  | "unsupported"
  | "init_failed"
  | "execution_failed"
  | "disposed"
  | "stale";

// message 只作为开发诊断标识，页面展示必须按 code 选择本地化 fallback。
const WORKER_CLIENT_ERROR_MESSAGE_BY_CODE: Readonly<Record<WorkerClientErrorCode, string>> = {
  unsupported: "worker.unsupported",
  init_failed: "worker.init_failed",
  execution_failed: "worker.execution_failed",
  disposed: "worker.disposed",
  stale: "worker.stale",
};

export class WorkerClientError extends Error {
  code: WorkerClientErrorCode; // code 是 renderer worker 边界唯一稳定分支依据

  /**
   * WorkerClientError 只把 code 作为稳定事实，message 保留非展示诊断标识。
   */
  constructor(code: WorkerClientErrorCode) {
    super(WORKER_CLIENT_ERROR_MESSAGE_BY_CODE[code]);
    this.name = "WorkerClientError";
    this.code = code;
  }
}

/**
 * worker client 错误窄化统一看 code，调用方不再比较自然语言 message。
 */
export function is_worker_client_error(
  error: unknown,
  code?: WorkerClientErrorCode,
): error is WorkerClientError {
  if (!(error instanceof WorkerClientError)) {
    return false;
  }

  return code === undefined || error.code === code;
}
