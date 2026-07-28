import { describe, expect, it } from "vitest";

import { find_import_specifiers, find_pattern_errors, format_boundary_errors } from "./core.mjs";

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

  it("为规则命中生成稳定行号和统一错误文本", () => {
    const errors = find_pattern_errors("ok\nforbidden\nok", /forbidden/g, () => "禁止项").map(
      (error) => ({
        rule_name: "示例规则",
        relative_path: "src/example.ts",
        ...error,
      }),
    );

    expect(errors).toEqual([
      {
        line: 2,
        message: "禁止项",
        relative_path: "src/example.ts",
        rule_name: "示例规则",
      },
    ]);
    expect(format_boundary_errors("边界检查", errors)).toBe(
      "边界检查失败：\n- [示例规则] src/example.ts:2 禁止项",
    );
    expect(format_boundary_errors("边界检查", [])).toBe("边界检查通过。");
  });
});
