import { describe, expect, it } from "vitest";

import {
  FileParseFailedError,
  RevisionConflictError,
  resolve_app_error_http_status,
  to_api_error_payload,
} from ".";
import { create_text_resolver } from "../i18n";

describe("API error", () => {
  it("公开形状只保留稳定 code、本地化键和安全 details", () => {
    const error = new RevisionConflictError({
      public_details: {
        section: "items",
        ignored: (() => undefined) as never,
      },
    });

    expect(resolve_app_error_http_status(error)).toBe(409);
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

  it("文件解析失败使用稳定错误码和本地化动作", () => {
    const error = new FileParseFailedError({
      public_details: { format: "EPUB", parser: "XML" },
    });

    expect(to_api_error_payload(error, "request-2", create_text_resolver("zh-CN"))).toEqual({
      code: "file.parse_failed",
      details: { format: "EPUB", parser: "XML" },
      message: "文件内容解析失败 …",
      message_key: "app.error.file.parse_failed.message",
      request_id: "request-2",
      action: "请确认文件内容完整，或换用原始未损坏的文件 …",
      action_key: "app.error.file.parse_failed.action",
    });
  });
});
