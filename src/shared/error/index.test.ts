import { describe, expect, it } from "vitest";

import {
  AppError,
  InternalInvariantError,
  RuntimeCancelledError,
  to_error_diagnostic,
} from "./index";

describe("shared error barrel", () => {
  it("统一导出 renderer、core 和测试共用的错误基类与诊断工具", () => {
    const error = new InternalInvariantError({
      diagnostic_context: {
        source: "barrel-test",
      },
    });

    expect(error).toBeInstanceOf(AppError);
    expect(new RuntimeCancelledError()).toBeInstanceOf(AppError);
    expect(error.diagnostic_context).toEqual({
      source: "barrel-test",
    });
    expect(to_error_diagnostic(error, error.diagnostic_context)).toMatchObject({
      name: "InternalInvariantError",
      message: "runtime.internal_invariant",
      context: {
        source: "barrel-test",
      },
    });
  });
});
