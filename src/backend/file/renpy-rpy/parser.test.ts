import { describe, expect, it } from "vitest";

import { parse_document } from "./parser";

describe("RenPy parser", () => {
  it("按 translate 边界生成块和语句分类", () => {
    const document = parse_document([
      "outside",
      "translate schinese strings:",
      "",
      '    old "START"',
      '    new "开始"',
      "translate schinese python:",
      '    # ignored "x"',
      "translate schinese start:",
      "    # game/script.rpy:10",
      '    # e "Hello"',
      '    e "你好"',
    ]);

    expect(document.blocks.map(({ lang, label, kind }) => ({ lang, label, kind }))).toEqual([
      { lang: "schinese", label: "strings", kind: "STRINGS" },
      { lang: "schinese", label: "python", kind: "PYTHON" },
      { lang: "schinese", label: "start", kind: "LABEL" },
    ]);
    expect(document.blocks[0]?.statements.map((statement) => statement.stmt_kind)).toEqual([
      "BLANK",
      "TEMPLATE",
      "TARGET",
    ]);
    expect(document.blocks[2]?.statements.map((statement) => statement.stmt_kind)).toEqual([
      "META",
      "TEMPLATE",
      "TARGET",
    ]);
    expect(document.blocks[2]?.statements[1]?.literals[0]?.value).toBe("Hello");
  });
});
