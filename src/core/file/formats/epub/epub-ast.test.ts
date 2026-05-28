import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { create_epub_fixture } from "../../../../test/epub-fixture";
import { Item } from "../../../../domain/item";
import { FileParseFailedError, InvalidFileStructureError } from "../../../../shared/error";
import { EpubAst, read_epub_extra } from "./epub-ast";

describe("EpubAst", () => {
  it("归一化 slot 文本时压缩行内空白", () => {
    const ast = new EpubAst();

    expect(ast.normalize_slot_text("a\n\tb  c")).toBe("a b c");
    expect(ast.normalize_slot_text("不变")).toBe("不变");
  });

  it("修复 HTML 命名实体时保留 CDATA 原文", () => {
    const ast = new EpubAst();

    const fixed = ast.normalize_html_named_entities_for_xml(
      "<p>&nbsp; &foo; <![CDATA[&nbsp;]]></p>",
    );

    expect(fixed).toContain("&#160;");
    expect(fixed).toContain("&amp;foo;");
    expect(fixed).toContain("<![CDATA[&nbsp;]]>");
  });

  it("修复 NCX 裸 ampersand 时不改 CDATA 和既有实体", () => {
    const ast = new EpubAst();

    const fixed = ast.fix_ncx_bare_ampersands("<text>a&b <![CDATA[c&d]]> e&amp;f</text>");

    expect(fixed).toContain("a&amp;b");
    expect(fixed).toContain("<![CDATA[c&d]]>");
    expect(fixed).toContain("e&amp;f");
  });

  it("从 EPUB spine 提取正文条目并写入 AST metadata", async () => {
    const ast = new EpubAst();
    const epub_asset = await create_epub_fixture("章节");

    const items = await ast.read_from_stream(epub_asset, "book.epub");
    const [item] = items;
    if (item === undefined) {
      throw new Error("EPUB fixture 未生成正文条目。");
    }
    const epub = read_epub_extra(item);

    expect(items).toHaveLength(1);
    expect(item).toEqual(
      expect.objectContaining({
        src: "章节",
        dst: "",
        row: 0,
        file_type: "EPUB",
        file_path: "book.epub",
        tag: "OPS/chapter.xhtml",
        status: "NONE",
      }),
    );
    expect(epub).toEqual(
      expect.objectContaining({
        mode: "slot_per_line",
        doc_path: "OPS/chapter.xhtml",
        block_path: "/html[1]/body[1]/p[1]",
        src_digest: expect.any(String),
        is_nav: false,
      }),
    );
    expect(epub?.["parts"]).toEqual([{ slot: "text", path: "/html[1]/body[1]/p[1]" }]);
  });

  it("提取 OPF 标题、NCX 目录并跳过非 HTML spine", async () => {
    const ast = new EpubAst();
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
    );
    zip.file(
      "OPS/package.opf",
      `<package version="x" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>  Book  Title  </dc:title></metadata>
        <manifest>
          <item id="chap" href="chapter.xhtm" media-type="application/xhtml+xml"/>
          <item id="bin" href="asset.bin" media-type="application/octet-stream"/>
          <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        </manifest>
        <spine toc="ncx"><itemref idref="bin"/><itemref idref="chap"/></spine>
      </package>`,
    );
    zip.file("OPS/chapter.xhtm", "<html><body><p>正文</p></body></html>");
    zip.file(
      "OPS/toc.ncx",
      "<ncx><navMap><navPoint><navLabel><text>A&B</text></navLabel></navPoint></navMap></ncx>",
    );
    const epub_asset = await zip.generateAsync({ compression: "STORE", type: "nodebuffer" });

    const items = await ast.read_from_stream(epub_asset, "book.epub");

    expect(items.map((item) => item.src)).toEqual([" Book Title ", "正文", "A&B"]);
    expect(items.map((item) => item.row)).toEqual([
      EpubAst.ROW_BASE_OPF_TITLE,
      EpubAst.ROW_MULTIPLIER,
      EpubAst.ROW_BASE_NCX,
    ]);
  });

  it("回归 EPUB issue：多个 spine 文档都会提取正文，不会只读取前言", async () => {
    const ast = new EpubAst();
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
    );
    zip.file(
      "OPS/package.opf",
      `<package version="3.0">
        <manifest>
          <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
          <item id="tail" href="tail.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
          <itemref idref="intro"/>
          <itemref idref="chapter"/>
          <itemref idref="tail"/>
        </spine>
      </package>`,
    );
    zip.file("OPS/intro.xhtml", "<html><body><p>前言</p></body></html>");
    zip.file("OPS/chapter.xhtml", "<html><body><p>正文</p><p>第二段</p></body></html>");
    zip.file("OPS/tail.xhtml", "<html><body><p>尾声</p></body></html>");
    const epub_asset = await zip.generateAsync({ compression: "STORE", type: "nodebuffer" });

    const items = await ast.read_from_stream(epub_asset, "book.epub");

    expect(items.map((item) => item.src)).toEqual(["前言", "正文", "第二段", "尾声"]);
  });

  it("回归 EPUB issue：div 直接承载正文时不会只提取章节编号", () => {
    const ast = new EpubAst();
    const raw = new TextEncoder().encode(
      `<html><body>
        <div>Chapter 2</div>
        <div>Remembering: The Children on Charlie</div>
        <div>正文直接放在 div 中</div>
      </body></html>`,
    );

    const items = ast.extract_items_from_document("OPS/chapter.xhtml", raw, 0, "book.epub");

    expect(items.map((item) => item.src)).toEqual([
      "Chapter 2",
      "Remembering: The Children on Charlie",
      "正文直接放在 div 中",
    ]);
  });

  it("回归 EPUB issue：HTML 命名实体之后的正文不会被截断", async () => {
    const ast = new EpubAst();
    const epub_asset = await create_epub_fixture("好&nbsp;不好");

    const [item] = await ast.read_from_stream(epub_asset, "book.epub");

    expect(item?.src).toContain("好");
    expect(item?.src).toContain("不好");
  });

  it("抽取 XHTML 时跳过 code 和 rt 子树并保留 tail 文本顺序", () => {
    const ast = new EpubAst();
    const raw = new TextEncoder().encode(
      "<html><body><p>Head<code>skip</code>Tail<ruby>漢<rt>かん</rt></ruby>End</p></body></html>",
    );

    const items = ast.extract_items_from_document("OPS/chapter.xhtml", raw, 0, "book.epub");

    expect(items.map((item) => item.src)).toEqual(["HeadTail漢End"]);
    expect(read_epub_extra(items[0] as Item)).toEqual(
      expect.objectContaining({
        mode: "block_text",
        block_path: "/html[1]/body[1]/p[1]",
      }),
    );
  });

  it("含 class 的 EPUB ruby 在导入时投影为去注音正文", async () => {
    const ast = new EpubAst();
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt>直<rt>なお</rt>希<rt>き</rt></ruby>',
    );

    const items = await ast.read_from_stream(epub_asset, "book.epub");
    const [item] = items;
    const epub = item === undefined ? null : read_epub_extra(item);

    expect(item?.src).toBe("宝條直希");
    expect(epub).toEqual(
      expect.objectContaining({
        mode: "block_text",
        doc_path: "OPS/chapter.xhtml",
        block_path: "/html[1]/body[1]/p[1]",
        src_digest: expect.any(String),
      }),
    );
    expect(epub).not.toHaveProperty("ruby_clean_candidate");
  });

  it("回归 EPUB issue：ruby 与 span 混排的人名不会被拆成多条或多行", async () => {
    const ast = new EpubAst();
    const epub_asset = await create_epub_fixture(
      "「<span>希</span><ruby>美<rt>み</rt></ruby>も行くわ！　何かしてないと落ち着かないし！」",
    );

    const items = await ast.read_from_stream(epub_asset, "book.epub");
    const [item] = items;
    const epub = item === undefined ? null : read_epub_extra(item);

    expect(items).toHaveLength(1);
    expect(item?.src).toBe("「希美も行くわ！　何かしてないと落ち着かないし！」");
    expect(item?.src).not.toContain("\n");
    expect(epub).toEqual(expect.objectContaining({ mode: "block_text" }));
  });

  it("block_text 正文投影在内联和尾文本边界使用同一归一口径", async () => {
    const ast = new EpubAst();
    const epub_asset = await create_epub_fixture("<ruby>A <rt>x</rt></ruby> B");

    const [item] = await ast.read_from_stream(epub_asset, "book.epub");

    expect(item?.src).toBe("A B");
  });

  it("缺少 EPUB metadata 时返回空 extra", () => {
    expect(
      read_epub_extra(
        Item.from_json({
          src: "原文",
          file_type: "TXT",
          file_path: "script.txt",
          extra_field: null,
        }),
      ),
    ).toBeNull();
  });

  it("归一 EPUB 内部路径为 zip 可比较格式", () => {
    const ast = new EpubAst();

    expect(ast.normalize_epub_path("OPS\\chapter.xhtml")).toBe("OPS/chapter.xhtml");
  });

  it("XML 和 HTML 都无法解析时抛出文件解析错误", () => {
    const ast = new EpubAst();

    expect(() => ast.parse_xhtml_or_html(new Uint8Array())).toThrow(FileParseFailedError);
    expect(() => ast.parse_xhtml_or_html(new Uint8Array())).toThrow("file.parse_failed");
  });

  it("EPUB 入口缺少 OPF rootfile 时抛出文件结构错误", async () => {
    const ast = new EpubAst();
    const zip = new JSZip();
    zip.file("META-INF/container.xml", "<container><rootfiles></rootfiles></container>");

    await expect(ast.parse_container_opf_path(zip)).rejects.toThrow(InvalidFileStructureError);
    await expect(ast.parse_container_opf_path(zip)).rejects.toThrow("file.invalid_structure");
  });
});
