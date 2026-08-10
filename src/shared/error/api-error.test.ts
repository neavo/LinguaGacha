import { describe, expect, it } from "vitest";

import { resolve_app_error_http_status, to_api_error_payload } from "./api-error";
import { AppError } from "./app-error";

describe("API error", () => {
  it("输出稳定状态、错误码和安全详情", () => {
    const error = new AppError("data.revision_conflict", {
      public_details: { section: "items" },
    });

    expect(resolve_app_error_http_status(error)).toBe(409);
    expect(to_api_error_payload(error)).toEqual({
      code: "data.revision_conflict",
      details: { section: "items" },
    });
  });
});
