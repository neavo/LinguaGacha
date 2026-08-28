import { describe, expect, it } from "vitest";

import { render_pdf_markdown_html } from "./pdf-markdown-html";

describe("render_pdf_markdown_html", () => {
  it("渲染 GFM 标题、列表、表格、删除线和代码", () => {
    const html = render_pdf_markdown_html(
      "# 标题\n\n- 条目\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n~~删除~~ `code`",
    );

    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>删除</del>");
    expect(html).toContain("<code>code</code>");
  });

  it("不激活 raw HTML，图片只保留已转义 alt 文本", () => {
    const html = render_pdf_markdown_html(
      '<script>alert("x")</script>保留正文\n\n![A < B](https://remote.example/image.png)',
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("remote.example");
    expect(html).toContain("保留正文");
    expect(html).toContain("A &lt; B");
  });
});
