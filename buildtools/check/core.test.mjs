import { describe, expect, it } from "vitest";

import { find_import_specifiers, find_pattern_errors } from "./core.mjs";

describe("check core", () => {
  it("提取静态、动态与转发导入并保留源码行号", () => {
    const specifiers = find_import_specifiers(`import type { A } from "./a";
import "./side-effect";
const lazy = import("./lazy");
export type { B } from "./b";
`).sort((left, right) => left.line - right.line);

    expect(specifiers).toEqual([
      { line: 1, specifier: "./a" },
      { line: 2, specifier: "./side-effect" },
      { line: 3, specifier: "./lazy" },
      { line: 4, specifier: "./b" },
    ]);
  });

  it("忽略说明和注释中的 import 示例，仍识别模板表达式内的真实导入", () => {
    const source = [
      `const description = 'await import("node:fs/promises")';`,
      '// import "node:fs";',
      'const text = `example import("ignored") ${await import("./actual")}`;',
    ].join("\n");
    expect(find_import_specifiers(source)).toEqual([{ line: 3, specifier: "./actual" }]);
  });

  it("为正则命中保留源码行号", () => {
    expect(find_pattern_errors("ok\r\nforbidden\nok", /forbidden/g, () => "禁止项")).toEqual([
      { line: 2, message: "禁止项" },
    ]);
  });
});
