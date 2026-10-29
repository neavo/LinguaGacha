import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../shared/error";
import { log_source_file_diagnostics } from "./source-file-parse-failure-reporter";

describe("source-file-parse-failure-reporter", () => {
  it("把解析、缺失和其它 IO 异常归一为稳定错误码", () => {
    const warning = vi.fn();
    log_source_file_diagnostics({
      source: "project-import",
      log_manager: { warning },
      failures: [
        new SyntaxError("bad json"),
        Object.assign(new Error("missing"), { code: "ENOENT" }),
        new Error(),
        new AppError("file.parse_failed"),
      ].map((error) => ({ source_path: "source.txt", rel_path: "", error })),
      warnings: [],
    });

    expect(warning.mock.calls.map(([, entry]) => entry.context.code)).toEqual([
      "file.parse_failed",
      "file.not_found",
      "file.io_failed",
      "file.parse_failed",
    ]);
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
