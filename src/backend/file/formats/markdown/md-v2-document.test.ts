import { describe, expect, it } from "vitest";

import { parse_markdown_v2_document, restore_markdown_v2_resources } from "./md-v2-document";

describe("Markdown V2 document", () => {
  it.each(["", "   \t", "\n"])("空白文档保留完整布局 %#", (text) => {
    const document = parse_markdown_v2_document(text);

    expect(document.units).toEqual([
      expect.objectContaining({
        kind: "document",
        before: text,
        src: "",
        after: "",
        excluded: true,
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

  it("表格保持单块，代码、HTML、frontmatter、分隔线和定义均排除", () => {
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

    expect(document.units.map((unit) => [unit.kind, unit.excluded])).toEqual([
      ["yaml", true],
      ["table", false],
      ["code", true],
      ["html", true],
      ["thematicBreak", true],
      ["definition", true],
    ]);
    expect(rebuild(document.units, document.resources)).toBe(text);
  });

  it("排除 TOML frontmatter", () => {
    const document = parse_markdown_v2_document('+++\ntitle = "demo"\n+++\n\n正文');

    expect(document.units.map((unit) => [unit.kind, unit.excluded])).toEqual([
      ["toml", true],
      ["paragraph", false],
    ]);
  });

  it("只含无 alt 图片的段落排除，图片 alt 与链接标签仍属于自然语言", () => {
    const text = "![](empty.png)\n\n![插图](cover.png) 与 [说明](guide.md)";

    const document = parse_markdown_v2_document(text);

    expect(document.units.map((unit) => unit.excluded)).toEqual([true, false]);
    expect(document.units[1]?.src).toContain("![插图](lg-resource:image/1)");
    expect(document.units[1]?.src).toContain("[说明](lg-resource:link/0)");
  });

  it("按资源类型独立编号并把 data URI 从块文本中移除", () => {
    const data_uri = "data:image/png;base64,AAABBB";
    const text = [
      `[站点](https://example.com) ![图](${data_uri})`,
      "",
      "[ref]: assets/manual.pdf",
      "",
      "![引用图][ref]",
    ].join("\n");

    const document = parse_markdown_v2_document(text);
    const item_text = document.units.map((unit) => unit.src).join("\n");

    expect(item_text).not.toContain(data_uri);
    expect([...document.resources]).toEqual([
      ["lg-resource:link/0", "https://example.com"],
      ["lg-resource:image/0", data_uri],
      ["lg-resource:definition/0", "assets/manual.pdf"],
    ]);
    expect(rebuild(document.units, document.resources)).toBe(text);
  });

  it("destination 与标签重复时不猜测替换位置", () => {
    const text = "[same](same)";

    const document = parse_markdown_v2_document(text);

    expect(document.units[0]?.src).toBe(text);
    expect(document.resources.size).toBe(0);
  });

  it("宽松恢复只处理首个合法 destination token", () => {
    const resources = new Map([
      ["lg-resource:image/0", "data:image/png;base64,AAA"],
      ["lg-resource:link/0", "https://example.com"],
    ]);
    const text = [
      "![图](lg-resource:image/0)",
      "![重复](lg-resource:image/0)",
      "[改写](lg-resource:link/9)",
      "普通 lg-resource:link/0",
      "[链接](lg-resource:link/0)",
    ].join("\n\n");

    expect(restore_markdown_v2_resources(text, resources)).toBe(
      [
        "![图](data:image/png;base64,AAA)",
        "![重复](lg-resource:image/0)",
        "[改写](lg-resource:link/9)",
        "普通 lg-resource:link/0",
        "[链接](https://example.com)",
      ].join("\n\n"),
    );
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

function rebuild(
  units: ReturnType<typeof parse_markdown_v2_document>["units"],
  resources: ReadonlyMap<string, string> = new Map(),
): string {
  return units
    .map((unit) => unit.before + restore_markdown_v2_resources(unit.src, resources) + unit.after)
    .join("");
}
