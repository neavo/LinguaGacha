import { describe, expect, it, vi } from "vitest";

import { create_text_resolver } from "../../shared/i18n";
import {
  build_source_file_parse_failure,
  log_source_file_parse_failures,
} from "./source-file-parse-failure-reporter";

describe("source-file-parse-failure-reporter", () => {
  it("把解析、缺失和其它 IO 异常归一为稳定失败记录", () => {
    const parse_failure = build_source_file_parse_failure({
      source_path: "E:/input/broken.json",
      rel_path: "nested/broken.json",
      error: new SyntaxError("bad json"),
    });
    const missing_error = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(parse_failure).toEqual({
      source_path: "E:/input/broken.json",
      rel_path: "nested/broken.json",
      filename: "broken.json",
      code: "file.parse_failed",
      message_key: "app.error.file.parse_failed.message",
    });
    expect(
      build_source_file_parse_failure({
        source_path: "missing.txt",
        rel_path: "",
        error: missing_error,
      }).code,
    ).toBe("file.not_found");
    expect(
      build_source_file_parse_failure({
        source_path: "locked.txt",
        rel_path: "",
        error: new Error(),
      }).code,
    ).toBe("file.io_failed");
  });

  it("日志输出用户可见原因和结构化文件上下文", () => {
    const warning = vi.fn();
    const failure = build_source_file_parse_failure({
      source_path: "E:/input/broken.json",
      rel_path: "broken.json",
      error: new SyntaxError("bad json"),
    });

    log_source_file_parse_failures({
      failures: [failure],
      log_manager: { warning },
      source: "file-preview",
      text: create_text_resolver("zh-CN"),
    });

    expect(warning).toHaveBeenCalledWith(expect.stringContaining("broken.json"), {
      source: "file-preview",
      context: {
        failed_files: [
          {
            source_path: "E:/input/broken.json",
            rel_path: "broken.json",
            code: "file.parse_failed",
            message_key: "app.error.file.parse_failed.message",
          },
        ],
      },
    });
  });
});
