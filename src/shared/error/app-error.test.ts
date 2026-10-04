import { describe, expect, it } from "vitest";

import {
  APP_ERROR_DEFINITIONS,
  AppError,
  read_error_message,
  is_app_error,
  is_app_error_code,
} from "./app-error";

describe("AppError", () => {
  it("构造稳定错误事实并过滤非 JSON 公开详情", () => {
    const cause = new Error("底层失败");
    const error = new AppError("runtime.internal_invariant", {
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
      message: "底层失败",
      public_details: {
        request: "safe",
        nested: { retry_count: 2 },
      },
      diagnostic_context: { stage: "commit" },
    });
    expect(error.cause).toBe(cause);
  });

  it("只将统一基类实例识别为受控应用错误", () => {
    expect(is_app_error(new AppError("request.validation_failed"))).toBe(true);
    expect(is_app_error(new Error("boom"))).toBe(false);
    expect(is_app_error({ code: "request.validation_failed" })).toBe(false);
  });

  it("错误码控制分类，原因独立保留", () => {
    const error = new AppError("runtime.busy");

    expect(error).toMatchObject({
      code: "runtime.busy",
      severity: "expected",
    });
    expect(APP_ERROR_DEFINITIONS[error.code].status).toBe(423);
    expect(is_app_error_code(error.code)).toBe(true);
    expect(is_app_error_code("unknown.code")).toBe(false);
  });

  it("包装者可补充原因，空消息使用兜底", () => {
    const cause = new Error("disk full");
    expect(
      new AppError("file.io_failed", { message: "Cannot save draft: disk full", cause }).message,
    ).toBe("Cannot save draft: disk full");
    expect(read_error_message(new Error("  "), "Unavailable")).toBe("Unavailable");
    expect(read_error_message("connection reset")).toBe("connection reset");
  });
});
