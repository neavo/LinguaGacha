import { describe, expect, it } from "vitest";

import {
  InternalInvariantError,
  RequestValidationError,
  RuntimeCapabilityMissingError,
  to_app_error_log_snapshot,
} from ".";

describe("shared/error", () => {
  it("日志快照保留诊断上下文和 cause 链", () => {
    const cause = new Error("底层失败");
    const error = new InternalInvariantError({
      cause,
      public_details: { request: "safe" },
    });

    const snapshot = to_app_error_log_snapshot(error, {
      context: { request_id: "request-1" },
    });

    expect(snapshot.level).toBe("error");
    expect(snapshot.error.context).toMatchObject({
      code: "runtime.internal_invariant",
      request_id: "request-1",
      public_details: { request: "safe" },
    });
    expect(snapshot.error.cause_chain).toEqual([
      expect.objectContaining({ name: "Error", message: "底层失败" }),
    ]);
  });

  it("expected 错误默认只进入 debug 诊断等级", () => {
    const snapshot = to_app_error_log_snapshot(new RequestValidationError());

    expect(snapshot.level).toBe("debug");
    expect(snapshot.error.context?.["severity"]).toBe("expected");
  });

  it("运行能力错误保留统一诊断上下文", () => {
    const error = new RuntimeCapabilityMissingError({
      public_details: { capability: "backend_api_port" },
      diagnostic_context: {
        reason: "exhausted_retryable_ports",
        max_attempts: 2,
      },
    });

    expect(error).toMatchObject({
      code: "runtime.capability_missing",
      public_details: { capability: "backend_api_port" },
      diagnostic_context: {
        reason: "exhausted_retryable_ports",
        max_attempts: 2,
      },
    });
  });
});
