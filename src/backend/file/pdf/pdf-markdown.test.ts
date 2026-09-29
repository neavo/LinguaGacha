import { expect, it } from "vitest";
import { parseDocument, DomUtils } from "htmlparser2";
import { pdf_markdown } from "./pdf-markdown";
import { read_pdf_document } from "./pdf-document";
import { create_pdf_fixture } from "./test-support";

const source = read_pdf_document(create_pdf_fixture());

it("共用插件渲染中文强调、公式、提示块和表格列对齐", () => {
  const { html } = pdf_markdown(
    "中文**「重点」**标记。 $x^2$\n\n$$\n\\frac{1}{2}\n$$\n\n> [!NOTE]\n> 提示内容\n\n| 左 | 右 |\n| :--- | ---: |\n| A | 2 |",
    source,
  );
  const tree = parseDocument(html);
  expect(
    DomUtils.getElementsByTagName("strong", tree.children).map(DomUtils.textContent),
  ).toContain("「重点」");
  expect(html).toContain('class="katex"');
  expect(html).toContain('class="katex-display"');
  expect(html).toContain("markdown-alert-note");
  expect(
    DomUtils.getElementsByTagName("td", tree.children).map((node) => node.attribs["align"]),
  ).toEqual(["left", "right"]);
});

it("普通代码和转义货币保持字面值，无效公式返回位置", () => {
  const { html } = pdf_markdown("`$x$`\n\n```txt\n$$bad$$\n```\n\n价格 \\$5 和 \\$10", source);
  expect(html).not.toContain('class="katex"');
  expect(DomUtils.textContent(parseDocument(html))).toContain("价格 $5 和 $10");
  expect(() => pdf_markdown("$\\notARealCommand{x}$", source)).toThrow(
    /Invalid PDF formula at 1:/u,
  );
});

it("引用图片按原稿校验并与相邻文字形成独立块", () => {
  const reference = `pdf-image:${source.digest}/3/40,180,120,80`;
  const { html, images } = pdf_markdown(`前文![图注][map]后文\n\n[map]: ${reference}`, source);
  // 检查原始层级，避免 HTML 解析器自动闭合 p 掩盖块级嵌套错误。
  const tree = parseDocument(html, { xmlMode: true });
  expect(tree.children.flatMap((node) => (node.type === "tag" ? [node.name] : []))).toEqual([
    "p",
    "figure",
    "p",
  ]);
  expect(images.get(reference)).toEqual({ page: 3, x: 40, y: 180, width: 120, height: 80 });
  for (const markdown of [
    "![x](https://example.com/x.png)",
    `![x](pdf-image:${source.digest}/3/299,0,10,10)`,
    `![x](pdf-image:${source.digest}/3/1..2,0,10,10)`,
  ])
    expect(() => pdf_markdown(markdown, source)).toThrow();
  expect(() => pdf_markdown("[坏链接](javascript:alert)", source)).toThrow("Unsupported PDF link");
});

it("原始 HTML 与脚本按字面文本输出", () => {
  const markdown = '正文<br>后文\n\n<!-- 核对说明 -->\n\n<script>alert("x")</script>';
  const tree = parseDocument(pdf_markdown(markdown, source).html);
  expect(DomUtils.textContent(tree)).toContain(
    '正文<br>后文\n<!-- 核对说明 -->\n<script>alert("x")</script>',
  );
  expect(DomUtils.getElementsByTagName("script", tree.children)).toHaveLength(0);
});
