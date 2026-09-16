import { read_pdf_document } from "./pdf-document";
import { expect, it } from "vitest";
import { create_pdf_fixture } from "./test-support";
import { pdf_markdown, render_pdf_html, render_pdf_translation } from "./pdf-translation";
import type { PDFTranslation, PDFTranslationSection } from "../../../../shared/pdf";
function translation(sections: PDFTranslationSection[]): PDFTranslation {
  return { sections, reviewed_pages: [], notes: "" };
}
it("跨页译稿连续排版，图片仅使用本原稿有效区域", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const image = `pdf-image:${document.source.digest}/3/40,180,120,80`;
  const rendered = render_pdf_translation(
    translation([
      {
        page_start: 1,
        page_end: 3,
        markdown: "# 译稿\n\n跨页完整句子。\n\n![图例](" + image + ")",
      },
    ]),
    document.source,
  );
  const html = await render_pdf_html({
    title: "译稿",
    rendered,
    renderImage: async () => new Uint8Array([1, 2, 3]),
  });
  expect(html).toContain("跨页完整句子。");
  expect(html).toContain('src="data:image/png;base64,AQID"');
  expect(html).toContain("<figure>");
  for (const markdown of [
    "![x](https://example.com/x.png)",
    `![x](pdf-image:${document.source.digest}/3/299,0,10,10)`,
    `![x](pdf-image:${document.source.digest}/3/1..2,0,10,10)`,
  ])
    expect(() => pdf_markdown(markdown, document.source)).toThrow();
});

it("译稿保留 HTML 字面内容，标签和脚本只作为文本输出", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const [rendered] = render_pdf_translation(
    translation([
      {
        page_start: 1,
        page_end: 1,
        markdown: '正文<br>后文\n\n<!-- 核对说明 -->\n\n<script>alert("x")</script>',
      },
    ]),
    document.source,
  );
  expect(rendered?.html).toContain("正文&lt;br&gt;后文");
  expect(rendered?.html).toContain("&lt;!-- 核对说明 --&gt;");
  expect(rendered?.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  expect(rendered?.images.size).toBe(0);
});

it("译稿范围有序且不重叠，允许部分核对和空译稿集合", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const section = { page_start: 2, page_end: 3, markdown: "译稿" };
  expect(render_pdf_translation(translation([section]), document.source)).toHaveLength(1);
  expect(render_pdf_translation(translation([]), document.source)).toEqual([]);
  for (const sections of [
    [{ ...section, page_start: 0 }],
    [{ ...section, page_end: 4 }],
    [{ ...section, page_end: 1 }],
    [section, section],
    [section, { ...section, page_start: 1, page_end: 1 }],
    [{ ...section, markdown: "  \n " }],
  ])
    expect(() => render_pdf_translation(translation(sections), document.source)).toThrow();
  expect(() =>
    render_pdf_translation({ ...translation([section]), reviewed_pages: [4] }, document.source),
  ).toThrow("Reviewed page");
});
