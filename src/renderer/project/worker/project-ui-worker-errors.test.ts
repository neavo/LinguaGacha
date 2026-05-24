import { describe, expect, it } from "vitest";

import {
  is_project_ui_worker_client_error,
  ProjectUiWorkerClientError,
} from "./project-ui-worker-errors";

describe("ProjectUiWorkerClientError", () => {
  it("把稳定错误码映射为页面不可见的诊断 message", () => {
    const diagnostic = {
      message: "worker_failed",
      context: {
        requestId: "req-1",
      },
    };

    const error = new ProjectUiWorkerClientError("execution_failed", diagnostic);

    expect(error.message).toBe("project_ui_worker_execution_failed");
    expect(error.code).toBe("execution_failed");
    expect(error.diagnostic).toBe(diagnostic);
    expect(is_project_ui_worker_client_error(error)).toBe(true);
    expect(is_project_ui_worker_client_error(error, "execution_failed")).toBe(true);
    expect(is_project_ui_worker_client_error(error, "disposed")).toBe(false);
    expect(is_project_ui_worker_client_error(new Error("x"))).toBe(false);
  });
});
