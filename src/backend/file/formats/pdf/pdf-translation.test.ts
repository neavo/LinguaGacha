import { read_pdf_document } from "./pdf-document";
import { expect, it } from "vitest";
import { create_pdf_fixture } from "./test-support";
import { render_pdf_html, render_pdf_translation } from "./pdf-translation";
import type { PDFTranslation, PDFTranslationSection } from "../../../../shared/pdf";
/** 构造完整译稿载荷，让范围与正文校验使用同一入口。 */
function translation(sections: PDFTranslationSection[]): PDFTranslation {
  return { sections, reviewed_pages: [], notes: "" };
}
it("打印模板将已校验的原稿图片内嵌为离线资源", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const image = `pdf-image:${document.source.digest}/3/40,180,120,80`;
  const rendered = render_pdf_translation(
    translation([
      {
        kind: "translate",
        page_start: 1,
        page_end: 3,
        markdown: "# 译稿\n\n跨页完整句子。\n\n![图例](" + image + ")",
      },
    ]),
    document.source,
  );
  const html = await render_pdf_html({
    title: "译稿",
    rendered: rendered.filter((entry) => entry !== null),
    size: document.source.pages[0]!,
    renderImage: async () => new Uint8Array([1, 2, 3]),
  });
  expect(html).toContain("跨页完整句子。");
  expect(html).toContain('src="data:image/png;base64,AQID"');
});

it("省略范围需要原因且不能清空文档，背景区域按原稿校验", () => {
  const { source } = read_pdf_document(create_pdf_fixture());
  expect(
    render_pdf_translation(
      translation([{ kind: "omit", page_start: 2, page_end: 2, reason: "装饰空页" }]),
      source,
    ),
  ).toEqual([null]);
  for (const sections of [
    [{ kind: "omit" as const, page_start: 1, page_end: 3, reason: "全部省略" }],
    [{ kind: "omit" as const, page_start: 2, page_end: 2, reason: " " }],
    [
      {
        kind: "translate" as const,
        page_start: 1,
        page_end: 1,
        markdown: "正文",
        background: { page: 3, x: 299, y: 0, width: 2, height: 1 },
      },
    ],
  ])
    expect(() => render_pdf_translation(translation(sections), source)).toThrow();
});

it("译稿范围有序且不重叠，允许部分核对和空译稿集合", () => {
  const document = read_pdf_document(create_pdf_fixture());
  const section = { kind: "translate" as const, page_start: 2, page_end: 3, markdown: "译稿" };
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
