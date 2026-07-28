import { describe, expect, it } from "vitest";

import {
  FileNotFoundError,
  InternalInvariantError,
  InvalidJsonError,
  RequestValidationError,
} from "../../shared/error";
import { create_text_resolver } from "../../shared/i18n";
import { api_error_envelope, normalize_api_error } from "./api-error";

describe("normalize_api_error", () => {
  it("保留 AppError，并把语法、文件和未知异常归一为公开错误", () => {
    const app_error = new RequestValidationError();
    const missing_file = Object.assign(new Error("sensitive path"), {
      code: "ENOENT",
      path: "/private/demo.lg",
    });

    expect(normalize_api_error(app_error)).toBe(app_error);
    expect(normalize_api_error(new SyntaxError("bad json"))).toBeInstanceOf(InvalidJsonError);
    expect(normalize_api_error(missing_file)).toMatchObject({
      code: "file.not_found",
      public_details: { filename: "demo.lg" },
    } satisfies Partial<FileNotFoundError>);
    expect(normalize_api_error(new Error("boom"))).toBeInstanceOf(InternalInvariantError);
  });
});

describe("api_error_envelope", () => {
  it("只输出安全字段和 request_id", () => {
    const error = new FileNotFoundError({
      public_details: { filename: "demo.lg" },
      diagnostic_context: { path: "/private/demo.lg" },
      cause: new Error("secret"),
    });

    const envelope = api_error_envelope(error, "request-1", create_text_resolver("zh-CN"));

    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: "file.not_found",
        details: { filename: "demo.lg" },
        request_id: "request-1",
      },
    });
    expect(envelope.error).not.toHaveProperty("diagnostic_context");
    expect(envelope.error).not.toHaveProperty("cause");
    expect(envelope.error).not.toHaveProperty("stack");
  });
});
