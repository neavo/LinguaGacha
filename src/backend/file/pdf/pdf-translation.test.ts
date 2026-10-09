import { parseDocument, DomUtils } from "htmlparser2";
import { read_pdf_document } from "./pdf-document";
import { expect, it, vi } from "vitest";
import { create_pdf_fixture } from "./test-support";
import {
  render_pdf_html,
  render_pdf_translation,
  render_pdf_page_translation,
} from "./pdf-translation";

it("多图与跨页重复引用只生成一次，图片顺序保持一致", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const first = `pdf-image:${document.digest}/3/40,180,120,80`;
  const second = `pdf-image:${document.digest}/3/0,0,20,20`;
  document.pages[0]!.translation = {
    kind: "translate",
    markdown: `跨页完整句子。\n\n![一](${first})\n\n![二](${second})`,
  };
  document.pages[1]!.translation = { kind: "translate", markdown: `![重复](${first})` };
  const renderImage = vi.fn(async (region: { x: number }) => new Uint8Array([region.x]));
  const html = await render_pdf_html({
    title: "<译稿>",
    size: document.pages[0]!,
    rendered: render_pdf_translation(document).filter((entry) => entry !== null),
    renderImage,
  });
  expect(renderImage).toHaveBeenCalledTimes(2);
  const tree = parseDocument(html);
  expect(
    DomUtils.getElementsByTagName("img", tree.children).map((node) => node.attribs.src),
  ).toEqual([
    "data:image/png;base64,KA==",
    "data:image/png;base64,AA==",
    "data:image/png;base64,KA==",
  ]);
  expect(html).toContain("&lt;译稿&gt;");
  expect(html).toContain("跨页完整句子。");
});
it.each([new Error("image failed"), new DOMException("cancelled", "AbortError")])(
  "图片失败或取消沿原路径传播 %s",
  async (error) => {
    const document = read_pdf_document(create_pdf_fixture());
    document.pages[0]!.translation = {
      kind: "translate",
      markdown: `![图](pdf-image:${document.digest}/3/0,0,20,20)`,
    };
    await expect(
      render_pdf_html({
        title: "译稿",
        size: document.pages[0]!,
        rendered: render_pdf_translation(document).filter((entry) => entry !== null),
        renderImage: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  },
);

it("空译稿和省略页返回空渲染结果", () => {
  const document = read_pdf_document(create_pdf_fixture());
  for (const page of document.pages) page.translation = { kind: "translate", markdown: " \n " };
  expect(render_pdf_translation(document)).toEqual([null, null, null]);
  for (const page of document.pages) page.translation = { kind: "omit", reason: "省略" };
  expect(render_pdf_translation(document)).toEqual([null, null, null]);
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
