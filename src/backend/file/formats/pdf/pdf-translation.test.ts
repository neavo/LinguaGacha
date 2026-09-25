import { parseDocument, DomUtils } from "htmlparser2";
import { read_pdf_document } from "./pdf-document";
import { expect, it } from "vitest";
import { create_pdf_fixture } from "./test-support";
import {
  render_pdf_html,
  render_pdf_translation,
  render_pdf_page_translation,
} from "./pdf-translation";

it("打印模板将已校验的原稿图片内嵌为离线资源", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const image = `pdf-image:${document.digest}/3/40,180,120,80`;
  document.pages[0]!.translation = {
    kind: "translate",
    markdown: "# 译稿\n\n跨页完整句子。\n\n![图例](" + image + ")",
  };
  const rendered = render_pdf_translation(document);
  const html = await render_pdf_html({
    title: "译稿",
    rendered: rendered.filter((entry) => entry !== null),
    size: document.pages[0]!,
    renderImage: async () => new Uint8Array([1, 2, 3]),
  });
  expect(html).toContain("跨页完整句子。");
  expect(html).toContain('src="data:image/png;base64,AQID"');
});

it("空译稿和省略页可独立保存，全部没有输出页时仅拒绝预览和导出", () => {
  const document = read_pdf_document(create_pdf_fixture());
  for (const page of document.pages) page.translation = { kind: "translate", markdown: " \n " };
  expect(() => render_pdf_translation(document)).toThrow("at least one page");
  for (const page of document.pages) page.translation = { kind: "omit", reason: "省略" };
  expect(() => render_pdf_translation(document)).toThrow("at least one page");
  document.pages[0]!.translation = null;
  expect(render_pdf_translation(document)).toEqual([null, null, null]);
  document.pages[0]!.translation = { kind: "keep", reason: "保留原页" };
  expect(render_pdf_translation(document)).toEqual([null, null, null]);
  for (const kind of ["keep", "omit"] as const) {
    document.pages[1]!.translation = { kind, reason: " " };
    expect(() => render_pdf_translation(document)).toThrow("require a reason");
  }
});

it("背景区域按原稿边界校验，空译稿也不能保存越界引用", () => {
  const document = read_pdf_document(create_pdf_fixture());
  document.pages[0]!.translation = {
    kind: "translate",
    markdown: "",
    background: { page: 3, x: 299, y: 0, width: 2, height: 1 },
  };
  expect(() => render_pdf_page_translation(document.pages[0]!, document)).toThrow("outside");
});

it("相邻页独立编译脚注与标题链接，各页同名引用互不干扰", () => {
  const document = read_pdf_document(create_pdf_fixture());
  for (const page of document.pages.slice(0, 2))
    page.translation = {
      kind: "translate",
      markdown: `# 标题\n\n[标题](#heading-1)\n\n正文[^a]。\n\n[^a]: 第 ${page.page} 页脚注。`,
    };
  const rendered = render_pdf_translation(document);
  const ids: string[] = [];
  for (const entry of rendered.filter((entry) => entry !== null)) {
    const tree = parseDocument(entry.html);
    const page_ids = DomUtils.findAll(
      (node) => typeof node.attribs["id"] === "string",
      tree.children,
    ).map((node) => node.attribs["id"]!);
    ids.push(...page_ids);
    const links = DomUtils.getElementsByTagName("a", tree.children).map(
      (node) => node.attribs["href"],
    );
    expect(links).toHaveLength(3); // 此页输入包含标题跳转、脚注引用和脚注回链。
    expect(links).toContain(
      `#${DomUtils.getElementsByTagName("h1", tree.children)[0]!.attribs["id"]}`,
    );
    for (const link of links) expect(page_ids).toContain(link!.slice(1));
  }
  expect(new Set(ids).size).toBe(ids.length);
});
