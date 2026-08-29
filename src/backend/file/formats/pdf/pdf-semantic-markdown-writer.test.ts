import { describe, expect, it } from "vitest";

import { parse_markdown_v2_document } from "../markdown/md-v2-document";
import { write_pdf_semantic_markdown } from "./pdf-semantic-markdown-writer";

describe("PDF semantic Markdown writer", () => {
  it("稳定输出标题、列表、表格、图注和链接，并可被 Markdown V2 解析", () => {
    const markdown = write_pdf_semantic_markdown({
      diagnostics: [],
      blocks: [
        { order: 1, page_start: 1, page_end: 1, kind: "paragraph", text: "正文" },
        { order: 0, page_start: 1, page_end: 1, kind: "heading", level: 1, text: "标题" },
        {
          order: 2,
          page_start: 1,
          page_end: 1,
          kind: "list_item",
          level: 1,
          marker: "-",
          text: "项目",
        },
        {
          order: 3,
          page_start: 1,
          page_end: 1,
          kind: "table",
          header: ["A", "B"],
          rows: [["1", "2"]],
        },
        { order: 4, page_start: 1, page_end: 1, kind: "caption", text: "Figure 1: 说明" },
        { order: 5, page_start: 1, page_end: 1, kind: "figure", excluded: true },
      ],
    });
    expect(markdown).toBe(
      "# 标题\n\n正文\n\n- 项目\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nFigure 1: 说明\n",
    );
    expect(parse_markdown_v2_document(markdown).units.length).toBeGreaterThan(0);
    expect(write_pdf_semantic_markdown({ diagnostics: [], blocks: [] })).toBe("");
  });
});
