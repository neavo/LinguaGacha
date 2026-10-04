import { describe, expect, it } from "vitest";

import { format_source_file_parse_failure_error_toast } from "@frontend/app/feedback/source-file-parse-failure-feedback";

describe("source file parse failure feedback", () => {
  it("错误提示只读取公开 details.failed_files", () => {
    expect(
      format_source_file_parse_failure_error_toast({
        message: "不得解析这段文本",
        details: {
          failed_files: [
            {
              filename: "broken.txt",
              code: "file.parse_failed",
              message: "Parser rejected the file",
            },
          ],
        },
      }),
    ).toBe("broken.txt - Parser rejected the file");

    expect(
      format_source_file_parse_failure_error_toast(new Error("broken.txt - parse_failed")),
    ).toBeNull();
    expect(format_source_file_parse_failure_error_toast({ details: {} })).toBeNull();
  });
});
