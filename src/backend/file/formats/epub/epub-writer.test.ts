import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { write_zip, read_zip_fixture, zip_text } from "../../../../test/zip-fixture";

import { create_epub_fixture, read_epub_entry_text } from "../../../../test/epub-fixture";
import { Item } from "../../../../domain/item";
import { EpubAst, read_epub_extra } from "./epub-ast";
import { distribute_text_to_slots, EpubWriter } from "./epub-writer";

/**
 * 写回器配置固定为日译中，便于断言导出后的可见正文
 */
function create_writer(target_language = "ZH"): EpubWriter {
  return new EpubWriter({
    target_language,
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

describe("EPUB item slot distribution", () => {
  it("fills missing slots and puts extra lines in the final slot", () => {
    expect(distribute_text_to_slots("甲", 3)).toEqual(["甲", "", ""]);
    expect(distribute_text_to_slots("甲\n乙", 2)).toEqual(["甲", "乙"]);
    expect(distribute_text_to_slots("甲\n乙\n丙", 2)).toEqual(["甲", "乙\n丙"]);
  });
});

/**
 * 构造带翻页方向、竖排 CSS 和横竖排 class 的 EPUB，专门覆盖写回排版策略
 */
async function create_layout_epub_fixture(): Promise<Buffer> {
  const zip = new Map<string, string | Uint8Array>();
  zip.set(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  zip.set(
    "OPS/package.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
  <metadata/>
  <manifest>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="chapter"/>
  </spine>
</package>`,
  );
  zip.set("OPS/style.css", ".vrtl { writing-mode: vertical-rl; color: red; }");
  zip.set(
    "OPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p class="vrtl keep" style="writing-mode: vertical-rl; color: red;">章节</p></body>
</html>`,
  );
  return write_zip(zip);
}

/**
 * 构造带目录导航链接的 EPUB，验证双语写回不会改坏章节目标。
 */
async function create_nav_epub_fixture(): Promise<Buffer> {
  const zip = new Map<string, string | Uint8Array>();
  zip.set(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
  );
  zip.set(
    "OPS/package.opf",
    `<package version="3.0">
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`,
  );
  zip.set(
    "OPS/nav.xhtml",
    `<html><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章</a></li></ol></nav></body></html>`,
  );
  zip.set("OPS/chapter.xhtml", "<html><body><p>章节</p></body></html>");
  return write_zip(zip);
}

/**
 * 构造带真实 NBSP 的 XHTML，覆盖 XML 输出实体合法性
 */
async function create_nbsp_xhtml_epub_fixture(): Promise<Buffer> {
  const zip = new Map<string, string | Uint8Array>();
  zip.set(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
  );
  zip.set(
    "OPS/package.opf",
    `<package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <manifest>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`,
  );
  zip.set(
    "OPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>\u00a0</p><p>章节</p></body>
</html>`,
  );
  return write_zip(zip);
}

/**
 * 构造无 XHTML 命名空间的普通 HTML，覆盖 HTML 输出行为
 */
async function create_plain_html_epub_fixture(): Promise<Buffer> {
  const zip = new Map<string, string | Uint8Array>();
  zip.set(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
  );
  zip.set(
    "OPS/package.opf",
    `<package version="3.0">
      <manifest>
        <item id="chapter" href="chapter.html" media-type="text/html"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`,
  );
  zip.set("OPS/chapter.html", "<html><body><p>章节</p></body></html>");
  return write_zip(zip);
}

/**
 * writer 测试只借 AST 生成定位 metadata，断言归属仍聚焦写回产物
 */
async function create_translated_epub_item(epub_asset: Buffer, dst: string): Promise<Item> {
  const [item] = await new EpubAst().read_from_stream(epub_asset, "book.epub");
  if (item === undefined) {
    throw new Error("EPUB fixture 未生成正文条目。");
  }
  return Item.from_json({
    ...item,
    dst,
    status: "PROCESSED",
  });
}

/** 以正文选择待译条目，避免书名和目录影响写回用例的定位。 */
async function create_translated_epub_item_by_src(
  epub_asset: Buffer,
  src: string,
  dst: string,
): Promise<Item> {
  const item = (await new EpubAst().read_from_stream(epub_asset, "book.epub")).find(
    (candidate) => candidate.src === src,
  );
  if (item === undefined) {
    throw new Error(`EPUB fixture 未生成正文条目：${src}`);
  }
  return Item.from_json({
    ...item.to_json(),
    dst,
    status: "PROCESSED",
  });
}

describe("EpubWriter", () => {
  it("按 AST metadata 写出译文并在双语版保留原文块", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const item = await create_translated_epub_item(epub_asset, "译文");
    const translated_path = path.join(temp_dir.path, "translated", "book.epub");
    const bilingual_path = path.join(temp_dir.path, "bilingual", "book.epub");

    await writer.build_epub(epub_asset, [item], translated_path, false);
    await writer.build_epub(epub_asset, [item], bilingual_path, true);

    await expect(read_epub_entry_text(fs.readFileSync(translated_path))).resolves.toContain("译文");
    await expect(read_epub_entry_text(fs.readFileSync(bilingual_path))).resolves.toContain("章节");
    await expect(read_epub_entry_text(fs.readFileSync(bilingual_path))).resolves.toContain("译文");
  });

  it("block_text 写回普通译文时移除 rt，双语原文块保留原始 ruby DOM", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt>直<rt>なお</rt>希<rt>き</rt></ruby>',
    );
    const item = await create_translated_epub_item(epub_asset, "宝条直希");
    const translated_path = path.join(temp_dir.path, "ruby-translated", "book.epub");
    const bilingual_path = path.join(temp_dir.path, "ruby-bilingual", "book.epub");

    await writer.build_epub(epub_asset, [item], translated_path, false);
    await writer.build_epub(epub_asset, [item], bilingual_path, true);

    const translated_text = await read_epub_entry_text(fs.readFileSync(translated_path));
    const bilingual_text = await read_epub_entry_text(fs.readFileSync(bilingual_path));

    expect(translated_text).toContain("宝条直希");
    expect(translated_text).not.toContain("<rt>");
    expect(bilingual_text).toContain('<ruby class="calibre3">');
    expect(bilingual_text).toContain("<rt>ほう</rt>");
    expect(bilingual_text).toContain("宝条直希");
  });

  it("block_text 写回校验复用读取器的规范空白口径", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("<ruby>A <rt>x</rt></ruby> B");
    const item = await create_translated_epub_item(epub_asset, "译文");
    const translated_path = path.join(temp_dir.path, "ruby-space-translated", "book.epub");

    await writer.build_epub(epub_asset, [item], translated_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(translated_path))).resolves.toContain("译文");
  });

  it("回归 EPUB issue：双语写回保留目录链接指向原有章节文件", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_nav_epub_fixture();
    const items = (await new EpubAst().read_from_stream(epub_asset, "book.epub")).map(
      (item, index) =>
        Item.from_json({
          ...item.to_json(),
          dst: `译文-${index}`,
          status: "PROCESSED",
        }),
    );
    const out_path = path.join(temp_dir.path, "nav-bilingual", "book.epub");

    await writer.build_epub(epub_asset, items, out_path, true);

    const nav_text = await read_epub_entry_text(fs.readFileSync(out_path), "OPS/nav.xhtml");
    expect(nav_text).toContain('href="chapter.xhtml"');
  });

  it("AST 写回保留 XML 合法补充平面字符", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const item = await create_translated_epub_item(epub_asset, "译文😀𠀀");
    const out_path = path.join(temp_dir.path, "supplementary", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(out_path))).resolves.toContain("译文😀𠀀");
  });

  it("AST 写回 XHTML 时把真实 NBSP 输出为 XML 合法内容", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_nbsp_xhtml_epub_fixture();
    const item = await create_translated_epub_item_by_src(epub_asset, "章节", "译文");
    const out_path = path.join(temp_dir.path, "nbsp-ast", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path));

    expect(written_text).not.toContain("&nbsp;");
    expect(written_text).toMatch(/&#x?a0;|&#160;|\u00a0/iu);
    expect(() => new EpubAst().parse_xml_document(written_text)).not.toThrow();
  });

  it("缺少 AST metadata 时回退 legacy 顺序写回", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const out_path = path.join(temp_dir.path, "legacy", "book.epub");
    const legacy_item = Item.from_json({
      src: "章节",
      dst: "译文",
      row: 0,
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      status: "PROCESSED",
    });

    expect(writer.has_epub_ast_metadata(legacy_item)).toBe(false);

    await writer.build_epub(epub_asset, [legacy_item], out_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(out_path))).resolves.toContain("译文");
  });

  it("legacy 写回 XHTML 时把真实 NBSP 输出为 XML 合法内容", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_nbsp_xhtml_epub_fixture();
    const out_path = path.join(temp_dir.path, "nbsp-legacy", "book.epub");
    const legacy_item = Item.from_json({
      src: "章节",
      dst: "译文",
      row: 0,
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      status: "PROCESSED",
    });

    await writer.build_epub(epub_asset, [legacy_item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path));

    expect(written_text).not.toContain("&nbsp;");
    expect(written_text).toMatch(/&#x?a0;|&#160;|\u00a0/iu);
    expect(() => new EpubAst().parse_xml_document(written_text)).not.toThrow();
  });

  it("普通 HTML 写回时不强加 XML 声明", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_plain_html_epub_fixture();
    const item = await create_translated_epub_item_by_src(epub_asset, "章节", "译文");
    const out_path = path.join(temp_dir.path, "plain-html", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path), "OPS/chapter.html");

    expect(written_text).toContain("译文");
    expect(written_text).not.toMatch(/^<\?xml/iu);
  });

  it("legacy 写回按字面量保留 replacement 特殊美元序列", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const out_path = path.join(temp_dir.path, "legacy-special-dollar", "book.epub");
    const legacy_item = Item.from_json({
      src: "章节",
      dst: "译文$& $1 $$",
      row: 0,
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      status: "PROCESSED",
    });

    await writer.build_epub(epub_asset, [legacy_item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path));

    expect(written_text).toContain("译文$&amp; $1 $$");
    expect(written_text).not.toContain("译文章节");
  });

  it.each(["JA", "ZH-HANT"] as const)(
    "目标语言为 %s 时 legacy 写回保留 EPUB 阅读排版信息",
    async (target_language) => {
      using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
      const writer = create_writer(target_language);
      const epub_asset = await create_layout_epub_fixture();
      const out_path = path.join(temp_dir.path, `layout-${target_language}`, "book.epub");
      const legacy_item = Item.from_json({
        src: "章节",
        dst: "译文",
        row: 0,
        file_type: "EPUB",
        file_path: "book.epub",
        tag: "OPS/chapter.xhtml",
        status: "PROCESSED",
      });

      await writer.build_epub(epub_asset, [legacy_item], out_path, false);

      const written_epub = fs.readFileSync(out_path);
      const opf_text = await read_epub_entry_text(written_epub, "OPS/package.opf");
      const css_text = await read_epub_entry_text(written_epub, "OPS/style.css");
      const xhtml_text = await read_epub_entry_text(written_epub);

      expect(opf_text).toContain('page-progression-direction="rtl"');
      expect(css_text).toContain("writing-mode: vertical-rl");
      expect(xhtml_text).toContain('class="vrtl keep"');
      expect(xhtml_text).toContain("writing-mode: vertical-rl");
    },
  );

  it("回归 EPUB issue：AST 写回繁中 EPUB 时保留直排和右翻页信息", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer("ZH-HANT");
    const epub_asset = await create_layout_epub_fixture();
    const item = await create_translated_epub_item(epub_asset, "译文");
    const out_path = path.join(temp_dir.path, "layout-ast", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    const written_epub = fs.readFileSync(out_path);
    const opf_text = await read_epub_entry_text(written_epub, "OPS/package.opf");
    const css_text = await read_epub_entry_text(written_epub, "OPS/style.css");
    const xhtml_text = await read_epub_entry_text(written_epub);

    expect(opf_text).toContain('page-progression-direction="rtl"');
    expect(css_text).toContain("writing-mode: vertical-rl");
    expect(xhtml_text).toContain('class="vrtl keep"');
    expect(xhtml_text).toContain("writing-mode: vertical-rl");
  });

  it("目标语言不需要保留阅读排版时继续清洗 EPUB 方向和竖排信息", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
    const writer = create_writer("ZH");
    const epub_asset = await create_layout_epub_fixture();
    const out_path = path.join(temp_dir.path, "layout-clean", "book.epub");
    const legacy_item = Item.from_json({
      src: "章节",
      dst: "译文",
      row: 0,
      file_type: "EPUB",
      file_path: "book.epub",
      tag: "OPS/chapter.xhtml",
      status: "PROCESSED",
    });

    await writer.build_epub(epub_asset, [legacy_item], out_path, false);

    const written_epub = fs.readFileSync(out_path);
    const opf_text = await read_epub_entry_text(written_epub, "OPS/package.opf");
    const css_text = await read_epub_entry_text(written_epub, "OPS/style.css");
    const xhtml_text = await read_epub_entry_text(written_epub);

    expect(opf_text).not.toContain('page-progression-direction="rtl"');
    expect(css_text).not.toContain("writing-mode: vertical-rl");
    expect(xhtml_text).toContain('class="keep"');
    expect(xhtml_text).not.toContain("writing-mode: vertical-rl");
  });
});

describe("EPUB manifest 路径写回", () => {
  it.each([
    ["chapter%20%28one%29.xhtml", "chapter (one).xhtml"],
    ["China%E2%80%99s.xhtml", "China’s.xhtml"],
    ["literal%2520.xhtml", "literal%20.xhtml"],
    ["100%.xhtml", "100%.xhtml"],
    ["one+two.xhtml", "one+two.xhtml"],
  ])("按 manifest href %s 读取并写回原 ZIP 文件名", async (href, file_name) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "epub-href-"));
    const zip = await read_zip_fixture(await create_epub_fixture("正文"));
    const chapter = zip_text(zip, "OPS/chapter.xhtml");
    const opf = zip_text(zip, "OPS/package.opf");
    zip.delete("OPS/chapter.xhtml");
    zip.set(`OPS/${file_name}`, chapter);
    zip.set("OPS/package.opf", opf.replace('href="chapter.xhtml"', `href="${href}"`));
    const bytes = await write_zip(zip);
    const items = await new EpubAst().read_from_stream(bytes, "book.epub");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ src: "正文", tag: `OPS/${file_name}` });
    expect(read_epub_extra(items[0]!)).toMatchObject({ doc_path: `OPS/${file_name}` });
    items[0]!.dst = "译文";
    items[0]!.status = "PROCESSED";
    for (const bilingual of [false, true]) {
      const out = path.join(temp.path, `${bilingual}.epub`);
      await create_writer().build_epub(bytes, items, out, bilingual);
      const output = await read_zip_fixture(fs.readFileSync(out));
      const text = zip_text(output, `OPS/${file_name}`);
      expect(text).toContain("译文");
      expect(text.includes("正文")).toBe(bilingual);
      expect(zip_text(output, "OPS/package.opf")).toContain(`href="${href}"`);
      expect([...output.keys()].sort()).toEqual([...zip.keys()].sort());
    }
  });
});

describe("EPUB 正文片段写回", () => {
  it.each([false, true])("连续片段与旧块共同写回，双语=%s 时保留资源和锚点", async (bilingual) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "epub-runs-"));
    const ast = new EpubAst();
    const zip = await read_zip_fixture(await create_epub_fixture("旧段落"));
    zip.set(
      "OPS/chapter.xhtml",
      `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      第一<span>片段</span><p> </p>前<ruby>漢<rt>かん</rt></ruby>后
      <img src="cover.png" alt=""/><span id="target">锚点</span><a href="#target">链接</a>
      <blockquote><span>引文</span>尾文</blockquote><p>旧段落</p><br/>结尾
    </body></html>`,
    );
    const bytes = await write_zip(zip);
    const items = await ast.read_from_stream(bytes, "book.epub");
    const expected_sources = ["第一片段", "前漢后", "锚点", "链接", "引文尾文", "旧段落", "结尾"];
    expect(items.map((item) => item.src.trim())).toEqual(expected_sources);
    for (const [index, item] of items.entries()) {
      item.dst = `译文${index}`;
      item.status = "PROCESSED";
    }
    const out = path.join(temp.path, "book.epub");
    await create_writer().build_epub(bytes, items, out, bilingual);
    const text = await read_epub_entry_text(fs.readFileSync(out));
    const root = ast.parse_xhtml_or_html(Buffer.from(text));
    expect(ast.find_descendants(root, "body")).toHaveLength(1);
    expect(ast.find_descendants(root, "img")[0]?.attribs).toEqual({ src: "cover.png", alt: "" });
    expect(text).toContain('alt=""');
    expect(ast.find_descendants(root, "a")[0]?.attribs["href"]).toBe("#target");
    expect(
      ast.flatten_elements(root).filter((node) => node.attribs["id"] === "target"),
    ).toHaveLength(1);
    const visible = ast.build_canonical_block_text(ast.find_descendants(root, "body")[0]!);
    for (const [index, source] of expected_sources.entries()) {
      expect(visible).toContain(`译文${index}`);
      expect(visible.includes(source)).toBe(bilingual);
    }
  });

  it("旧定位继续写回，片段摘要不匹配时保留源文，未译片段保留内联排版", async () => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "epub-runs-"));
    const ast = new EpubAst();
    const zip = await read_zip_fixture(await create_epub_fixture("旧段落"));
    const [old] = await ast.read_from_stream(await write_zip(zip), "book.epub");
    zip.set(
      "OPS/chapter.xhtml",
      '<html><body><span class="italic">新片段</span><p>旧段落</p>尾文</body></html>',
    );
    const bytes = await write_zip(zip);
    const runs = (await ast.read_from_stream(bytes, "book.epub")).filter(
      (item) => read_epub_extra(item)?.["mode"] === "text_run",
    );
    const corrupt = runs[1]!;
    read_epub_extra(corrupt)!["src_digest"] = "mismatch";
    corrupt.dst = "错误译文";
    corrupt.status = "PROCESSED";
    old!.dst = "旧译文";
    old!.status = "PROCESSED";
    const out = path.join(temp.path, "book.epub");
    await create_writer().build_epub(bytes, [old!, ...runs], out, false);
    const text = await read_epub_entry_text(fs.readFileSync(out));
    expect(text).toContain('<span class="italic">新片段</span>');
    expect(text).toContain("旧译文");
    expect(text).toContain("尾文");
    expect(text).not.toContain("错误译文");
  });
});
