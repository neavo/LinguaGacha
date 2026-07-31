import { describe, expect, it } from "vitest";

import { APP_ERROR_DEFINITIONS, AppError, is_app_error } from "./app-error";
import { RuntimeBusyError } from "./errors/runtime-errors";

describe("AppError", () => {
  it("构造稳定错误事实并过滤非 JSON 公开详情", () => {
    const cause = new Error("底层失败");
    const error = new AppError({
      code: "runtime.internal_invariant",
      public_details: {
        request: "safe",
        nested: { retry_count: 2 },
        ignored: (() => undefined) as never,
      },
      diagnostic_context: { stage: "commit" },
      cause,
    });

    expect(error).toMatchObject({
      code: "runtime.internal_invariant",
      severity: "fault",
      message_key: "app.error.runtime.internal_invariant.message",
      public_details: {
        request: "safe",
        nested: { retry_count: 2 },
      },
      diagnostic_context: { stage: "commit" },
    });
    expect(error.cause).toBe(cause);
  });

  it("只将统一基类实例识别为受控应用错误", () => {
    expect(is_app_error(new AppError({ code: "request.validation_failed" }))).toBe(true);
    expect(is_app_error(new Error("boom"))).toBe(false);
    expect(is_app_error({ code: "request.validation_failed" })).toBe(false);
  });

  it("统一运行时冲突公开稳定错误码、文案键和 HTTP 状态", () => {
    const error = new RuntimeBusyError();

    expect(error).toMatchObject({
      code: "runtime.busy",
      message_key: "app.error.runtime.busy.message",
      action_key: "app.error.runtime.busy.action",
      severity: "expected",
    });
    expect(APP_ERROR_DEFINITIONS[error.code].status).toBe(423);
  });
});
