export type WorkerClientErrorCode = "unsupported" | "init_failed" | "execution_failed" | "disposed";

export class WorkerClientError extends Error {
  code: WorkerClientErrorCode;

  constructor(message: string, code: WorkerClientErrorCode) {
    super(message);
    this.name = "WorkerClientError";
    this.code = code;
  }
}

export function is_worker_client_error(
  error: unknown,
  code?: WorkerClientErrorCode,
): error is WorkerClientError {
  if (!(error instanceof WorkerClientError)) {
    return false;
  }

  return code === undefined || error.code === code;
}
