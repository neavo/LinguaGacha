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
          message: "Parser rejected the file",
        },
        { filename: "missing-code.json" },
        {
          filename: "unknown-code.json",
          code: "file.unknown",
          message: "Parser rejected the file",
        },
        null,
      ]),
    ).toEqual([
      {
        source_path: "E:/source/demo.json",
        rel_path: "data/demo.json",
        filename: "demo.json",
        code: "file.parse_failed",
        message: "Parser rejected the file",
      },
    ]);
  });

  it("逐行保留全部文件的原始原因", () => {
    expect(
      format_source_file_parse_failure_notice([
        {
          source_path: "E:/source/a.json",
          rel_path: "a.json",
          filename: "a.json",
          code: "file.parse_failed",
          message: "Parser rejected the file",
        },
        {
          source_path: "E:/source/b.xlsx",
          rel_path: "b.xlsx",
          filename: "b.xlsx",
          code: "file.invalid_structure",
          message: "Parser rejected the file",
        },
      ]),
    ).toBe("a.json - Parser rejected the file\n" + "b.xlsx - Parser rejected the file");
  });
});
