import { describe, expect, it } from "vitest";

import { AppError } from "../../shared/error";
import { api_error_envelope, normalize_api_error } from "./api-error";

describe("normalize_api_error", () => {
  it("保留 AppError，并把语法、文件和未知异常归一为公开错误", () => {
    const app_error = new AppError("request.validation_failed");
    const missing_file = Object.assign(new Error("sensitive path"), {
      code: "ENOENT",
      path: "/private/demo.lg",
    });

    expect(normalize_api_error(app_error)).toBe(app_error);
    expect(normalize_api_error(new SyntaxError("bad json"))).toMatchObject({
      code: "request.invalid_json",
    });
    expect(normalize_api_error(missing_file)).toMatchObject({
      code: "file.not_found",
      public_details: { filename: "demo.lg" },
    } satisfies Partial<AppError>);
    expect(normalize_api_error(new Error("boom"))).toMatchObject({
      code: "runtime.internal_invariant",
    });
  });
});

describe("api_error_envelope", () => {
  it("只输出错误码和安全详情", () => {
    const error = new AppError("file.not_found", {
      public_details: { filename: "demo.lg" },
      diagnostic_context: { path: "/private/demo.lg" },
      cause: new Error("secret"),
    });

    const envelope = api_error_envelope(error);

    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: "file.not_found",
        details: { filename: "demo.lg" },
      },
    });
    expect(envelope.error).not.toHaveProperty("diagnostic_context");
    expect(envelope.error).not.toHaveProperty("cause");
    expect(envelope.error).not.toHaveProperty("stack");
  });
});
