import { describe, expect, it } from "vitest";

import {
  format_source_file_parse_failure_notice,
  normalize_source_file_parse_failures,
} from "./source-file-parse-failure";

describe("source file parse failure", () => {
  it("只收窄带有效错误码的可展示失败记录", () => {
    expect(
      normalize_source_file_parse_failures([
        {
          source_path: " E:/source/demo.json ",
          rel_path: " data/demo.json ",
          filename: " demo.json ",
          code: " file.parse_failed ",
        },
        { filename: "missing-code.json" },
        { filename: "unknown-code.json", code: "file.unknown" },
        null,
      ]),
    ).toEqual([
      {
        source_path: "E:/source/demo.json",
        rel_path: "data/demo.json",
        filename: "demo.json",
        code: "file.parse_failed",
      },
    ]);
  });

  it("逐行格式化全部失败文件及本地化原因", () => {
    expect(
      format_source_file_parse_failure_notice({
        failures: [
          {
            source_path: "E:/source/a.json",
            rel_path: "a.json",
            filename: "a.json",
            code: "file.parse_failed",
          },
          {
            source_path: "E:/source/b.xlsx",
            rel_path: "b.xlsx",
            filename: "b.xlsx",
            code: "file.invalid_structure",
          },
        ],
        text: (key) => `原因:${key}`,
      }),
    ).toBe(
      "a.json - 原因:app.error.file.parse_failed.message\n" +
        "b.xlsx - 原因:app.error.file.invalid_structure.message",
    );
  });
});
