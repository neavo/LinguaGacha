import { describe, expect, it } from "vitest";

import { AGENT_WORKSPACE_HTML_TOOLS } from "./html-to-markdown";

const HTML = `
  <html><body>
    <nav>导航</nav>
    <main>
      <h1>正文标题</h1>
      <p>阅读<a href="/guide">链接</a>。</p>
      <aside>广告</aside>
    </main>
    <footer>页脚</footer>
  </body></html>
`;

describe("Agent Workspace HTML 工具", () => {
  it("按稳定产品选项提取正文、过滤元素并解析相对链接", () => {
    const markdown = AGENT_WORKSPACE_HTML_TOOLS.htmlToMarkdown(HTML, {
      baseUrl: "https://example.com/article",
      mainContent: true,
      exclude: ["aside"],
    });

    expect(markdown).toContain("# 正文标题");
    expect(markdown).toContain("[链接](https://example.com/guide)");
    expect(markdown).not.toContain("导航");
    expect(markdown).not.toContain("广告");
    expect(markdown).not.toContain("页脚");
  });

  it("流式入口直接消费 Response body", async () => {
    const chunks: string[] = [];
    for await (const chunk of AGENT_WORKSPACE_HTML_TOOLS.streamHtmlToMarkdown(
      new Response(HTML).body,
      { baseUrl: "https://example.com/article", include: ["main"] },
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toContain("[链接](https://example.com/guide)");
    expect(chunks.join("")).not.toContain("导航");
  });

  it("拒绝同时声明两种正文入口", () => {
    expect(() =>
      AGENT_WORKSPACE_HTML_TOOLS.htmlToMarkdown(HTML, {
        mainContent: true,
        include: ["article"],
      }),
    ).toThrow("mainContent and include cannot be used together");
  });
});
