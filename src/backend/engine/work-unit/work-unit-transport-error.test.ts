import { describe, expect, it } from "vitest";

import { WorkUnitExecutorTransportError } from "./work-unit-transport-error";

describe("WorkUnitExecutorTransportError", () => {
  it("保留 worker 传输失败的诊断和原始 cause", () => {
    const cause = new Error("worker channel closed");
    const diagnostic = {
      message: "worker_transport_failed",
      context: {
        worker: "translation",
      },
    };

    const error = new WorkUnitExecutorTransportError(diagnostic, cause);

    expect(error).toBeInstanceOf(WorkUnitExecutorTransportError);
    expect(error.name).toBe("WorkUnitExecutorTransportError");
    expect(error.cause_error).toBe(cause);
    expect(error.diagnostic_context).toEqual({
      failure: diagnostic,
    });
  });
});
