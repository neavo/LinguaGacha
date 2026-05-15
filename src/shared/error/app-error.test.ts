import { describe, expect, it } from "vitest";

import {
  InternalInvariantError,
  RequestValidationError,
  RevisionConflictError,
  to_api_error_payload,
  to_app_error_log_projection,
} from ".";
import { create_text_resolver } from "../i18n";

describe("shared/error", () => {
  it("API 投影只暴露稳定 code、message_key 和安全 details", () => {
    const error = new RevisionConflictError({
      public_details: {
        section: "items",
        ignored: (() => undefined) as never,
      },
    });

    expect(to_api_error_payload(error, "request-1", create_text_resolver("zh-CN"))).toEqual({
      code: "data.revision_conflict",
      details: { section: "items" },
      message: "数据版本已变化，请刷新后重试 …",
      message_key: "app.error.data.revision_conflict.message",
      request_id: "request-1",
      action: "请刷新当前数据后再次提交 …",
      action_key: "app.error.data.revision_conflict.action",
    });
  });

  it("日志投影保留诊断上下文和 cause 链", () => {
    const cause = new Error("底层失败");
    const error = new InternalInvariantError({
      cause,
      public_details: { request: "safe" },
    });

    const projection = to_app_error_log_projection(error, {
      context: { request_id: "request-1" },
    });

    expect(projection.level).toBe("error");
    expect(projection.context).toMatchObject({
      code: "runtime.internal_invariant",
      request_id: "request-1",
      public_details: { request: "safe" },
      cause_chain: [{ name: "Error", message: "底层失败" }],
    });
  });

  it("expected 错误默认只进入 debug 诊断等级", () => {
    const projection = to_app_error_log_projection(new RequestValidationError());

    expect(projection.level).toBe("debug");
    expect(projection.context["severity"]).toBe("expected");
  });
});
