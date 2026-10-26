import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/error";
import {
  build_source_file_parse_failure,
  log_source_file_diagnostics,
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
      message: "bad json",
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
    expect(
      build_source_file_parse_failure({
        source_path: "broken.txt",
        rel_path: "broken.txt",
        error: new AppError("file.parse_failed"),
      }).code,
    ).toBe("file.parse_failed");
  });

  it("每个来源失败和每个局部遗漏各记一条日志，保留原始异常与定位", () => {
    const warning = vi.fn();
    const first = new SyntaxError("bad json");
    const member_error = { name: "Error", message: "member denied" };
    log_source_file_diagnostics({
      source: "project-import",
      log_manager: { warning },
      failures: [
        { source_path: "E:/input/broken.json", rel_path: "broken.json", error: first },
        { source_path: "E:/input/locked.txt", rel_path: "locked.txt", error: new Error("locked") },
      ],
      warnings: [
        {
          code: "script_syntax_error",
          rel_path: "game",
          internal_file_path: "data/CommonEvents.json",
          json_path: [1, "list", 0, "parameters", 0],
          diagnostics: [{ message: "Unexpected token", line: 2, column: 4 }],
        },
        {
          code: "source_preparation_failed",
          rel_path: "game",
          internal_file_path: "data/Locked.json",
          stage: "read",
          error: member_error,
          diagnostics: [{ message: "member denied", line: null, column: null }],
        },
      ],
    });

    expect(warning).toHaveBeenCalledTimes(4);
    expect(warning).toHaveBeenNthCalledWith(1, "broken.json - bad json", {
      source: "project-import",
      error: first,
      context: {
        source_path: "E:/input/broken.json",
        rel_path: "broken.json",
        code: "file.parse_failed",
      },
    });
    expect(warning).toHaveBeenNthCalledWith(
      3,
      'game/data/CommonEvents.json $[1]["list"][0]["parameters"][0]:2:4 - Unexpected token',
      expect.objectContaining({ source: "project-import", error: undefined }),
    );
    expect(warning).toHaveBeenNthCalledWith(
      4,
      "game/data/Locked.json  - member denied",
      expect.objectContaining({ error: member_error }),
    );
  });
});
