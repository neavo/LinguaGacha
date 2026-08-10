import { describe, expect, it } from "vitest";

import {
  APP_ERROR_DEFINITIONS,
  AppError,
  type AppErrorCode,
  app_error_message_key,
  is_app_error,
  is_app_error_code,
} from "./app-error";
import { MESSAGE_MAP_BY_LOCALE } from "../i18n";

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
      message: "runtime.internal_invariant",
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

  it("由定义表统一提供错误码、文案键和 HTTP 状态", () => {
    const error = new AppError("runtime.busy");

    expect(error).toMatchObject({
      code: "runtime.busy",
      severity: "expected",
    });
    expect(app_error_message_key(error.code)).toBe("app.error.runtime.busy.message");
    expect(APP_ERROR_DEFINITIONS[error.code].status).toBe(423);
    expect(is_app_error_code(error.code)).toBe(true);
    expect(is_app_error_code("unknown.code")).toBe(false);
  });

  it("每个稳定错误码都落到权威 locale 的可见文案", () => {
    for (const code of Object.keys(APP_ERROR_DEFINITIONS) as AppErrorCode[]) {
      const message_key = app_error_message_key(code);
      expect(MESSAGE_MAP_BY_LOCALE["zh-CN"].has(message_key)).toBe(true);
    }
  });
});
