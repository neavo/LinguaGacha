import { describe, expect, it } from "vitest";

import {
  format_source_file_parse_failure_error_toast,
  format_source_file_parse_failure_toast,
} from "@frontend/app/feedback/source-file-parse-failure-feedback";
import type { TextResolver } from "@shared/i18n";

const text: TextResolver = (key) => `原因：${key}`;

describe("source file parse failure feedback", () => {
  it("过滤不可展示记录并逐文件生成完整提示", () => {
    expect(
      format_source_file_parse_failure_toast({
        value: [
          {
            filename: "chapter01.txt",
            code: "decode_failed",
            message_key: "app.error.decode_failed.message",
          },
          { filename: "", code: "missing_filename" },
          {
            filename: "chapter02.txt",
            code: "parse_failed",
            message_key: "app.error.parse_failed.message",
          },
        ],
        text,
      }),
    ).toBe(
      "chapter01.txt - 原因：app.error.decode_failed.message\n" +
        "chapter02.txt - 原因：app.error.parse_failed.message",
    );
  });

  it("错误提示只读取公开 details.failed_files", () => {
    expect(
      format_source_file_parse_failure_error_toast({
        error: {
          message: "不得解析这段文本",
          details: {
            failed_files: [{ filename: "broken.txt", code: "parse_failed" }],
          },
        },
        text,
      }),
    ).toBe("broken.txt - 原因：app.error.parse_failed.message");

    expect(
      format_source_file_parse_failure_error_toast({
        error: new Error("broken.txt - parse_failed"),
        text,
      }),
    ).toBeNull();
  });
});
