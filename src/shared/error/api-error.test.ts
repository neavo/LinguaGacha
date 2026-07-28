import { describe, expect, it } from "vitest";

import type { TextResolver } from "../i18n";
import { resolve_app_error_http_status, to_api_error_payload } from "./api-error";
import { AppError } from "./app-error";

const resolve_text: TextResolver = (key, params = {}) => {
  return `${key}:${params["SECTION"] ?? ""}`;
};

describe("API error", () => {
  it("输出稳定状态、错误码、本地化键和安全详情", () => {
    const error = new AppError({
      code: "data.revision_conflict",
      public_details: { section: "items" },
    });

    expect(resolve_app_error_http_status(error)).toBe(409);
    expect(to_api_error_payload(error, "request-1", resolve_text)).toEqual({
      code: "data.revision_conflict",
      details: { section: "items" },
      message: "app.error.data.revision_conflict.message:items",
      message_key: "app.error.data.revision_conflict.message",
      request_id: "request-1",
      action: "app.error.data.revision_conflict.action:items",
      action_key: "app.error.data.revision_conflict.action",
    });
  });
});
