import { describe, expect, it } from "vitest";

import { parse_markdown_v2_document } from "./md-v2-document";

describe("Markdown V2 document", () => {
  it.each(["", "   \t", "\n"])("空白文档保留完整布局 %#", (text) => {
    const document = parse_markdown_v2_document(text);

    expect(document.units).toEqual([
      expect.objectContaining({
        kind: "document",
        before: text,
        src: "",
        after: "",
        rule_skipped: true,
      }),
    ]);
  });

  it("按原子块保留容器标记、混合换行和末尾布局", () => {
    const text = "# 标题\r\n\r\n> 第一行\n> 第二行\r\n\r\n- 项目一\n  - 项目二\n\n尾段\n";

    const document = parse_markdown_v2_document(text);

    expect(
      document.units.map(({ kind, src, before, after, start_line }) => ({
        kind,
        src,
        before,
        after,
        start_line,
      })),
    ).toEqual([
      { kind: "heading", src: "# 标题", before: "", after: "", start_line: 0 },
      {
        kind: "paragraph",
        src: "第一行\n> 第二行",
        before: "\r\n\r\n> ",
        after: "",
        start_line: 2,
      },
      {
        kind: "paragraph",
        src: "项目一",
        before: "\r\n\r\n- ",
        after: "",
        start_line: 5,
      },
      {
        kind: "paragraph",
        src: "项目二",
        before: "\n  - ",
        after: "",
        start_line: 6,
      },
      { kind: "paragraph", src: "尾段", before: "\n\n", after: "\n", start_line: 8 },
    ]);
    expect(rebuild(document.units)).toBe(text);
  });

  it("表格保持单块，代码、HTML、frontmatter、分隔线和定义均按结构规则跳过", () => {
    const text = [
      "---",
      "title: demo",
      "---",
      "",
      "| A | B |",
      "| - | - |",
      "| 甲 | 乙 |",
      "",
      "~~~ts",
      "const value = 1;",
      "~~~",
      "",
      "<div>原文</div>",
      "",
      "***",
      "",
      "[ref]: https://example.com",
    ].join("\n");

    const document = parse_markdown_v2_document(text);

    expect(document.units.map((unit) => [unit.kind, unit.rule_skipped])).toEqual([
      ["yaml", true],
      ["table", false],
      ["code", true],
      ["html", true],
      ["thematicBreak", true],
      ["definition", true],
    ]);
    expect(rebuild(document.units)).toBe(text);
  });

  it("TOML frontmatter 按结构规则跳过", () => {
    const document = parse_markdown_v2_document('+++\ntitle = "demo"\n+++\n\n正文');

    expect(document.units.map((unit) => [unit.kind, unit.rule_skipped])).toEqual([
      ["toml", true],
      ["paragraph", false],
    ]);
  });

  it("只含无 alt 图片的段落按规则跳过，图片 alt 与链接标签仍属于自然语言", () => {
    const text = "![](empty.png)\n\n![插图](cover.png) 与 [说明](guide.md)";

    const document = parse_markdown_v2_document(text);

    expect(document.units.map((unit) => unit.rule_skipped)).toEqual([true, false]);
    expect(document.units[1]?.src).toContain("![插图](cover.png)");
    expect(document.units[1]?.src).toContain("[说明](guide.md)");
  });

  it("在块文本中原样保留 URI、Base64 data URI 和相对资源路径", () => {
    const data_uri = "data:image/png;base64,AAABBB";
    const text = [
      `[站点](https://example.com) ![图](${data_uri})`,
      "",
      "[ref]: assets/manual.pdf",
      "",
      "![引用图][ref]",
    ].join("\n");

    const document = parse_markdown_v2_document(text);
    expect(document.units.map((unit) => unit.src).join("\n")).toContain(data_uri);
    expect(rebuild(document.units)).toBe(text);
  });

  it("产生按源顺序稳定、互不重叠且起始行唯一的块", () => {
    const document = parse_markdown_v2_document(
      "标题\n===\n\n1. 一\n2. 二\n\n> 引用\n\n```\ncode\n```\n",
    );

    for (const [index, unit] of document.units.entries()) {
      expect(unit.end_offset).toBeGreaterThanOrEqual(unit.start_offset);
      if (index > 0) {
        expect(unit.start_offset).toBeGreaterThanOrEqual(document.units[index - 1]!.end_offset);
      }
    }
    expect(new Set(document.units.map((unit) => unit.start_line)).size).toBe(document.units.length);
  });
});

function rebuild(units: ReturnType<typeof parse_markdown_v2_document>["units"]): string {
  return units.map((unit) => unit.before + unit.src + unit.after).join("");
}
