import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";

import { create_epub_fixture, read_epub_entry_text } from "../../../../test/epub-fixture";
import { Item } from "../../../../domain/item";
import { EpubAst } from "./epub-ast";
import { EpubWriter } from "./epub-writer";

let temp_dir = ""; // 每个用例独占 EPUB 输出目录，避免 zip 写回结果互相污染

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-epub-writer-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

/**
 * 写回器配置固定为日译中，便于断言导出后的可见正文
 */
function create_writer(target_language = "ZH"): EpubWriter {
  return new EpubWriter({
    source_language: "JA",
    target_language,
    deduplication_in_bilingual: true,
    write_translated_name_fields_to_file: true,
  });
}

/**
 * 构造带翻页方向、竖排 CSS 和横竖排 class 的 EPUB，专门覆盖写回排版策略
 */
async function create_layout_epub_fixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  zip.file(
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
  zip.file("OPS/style.css", ".vrtl { writing-mode: vertical-rl; color: red; }");
  zip.file(
    "OPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p class="vrtl keep" style="writing-mode: vertical-rl; color: red;">章节</p></body>
</html>`,
  );
  return zip.generateAsync({ compression: "STORE", type: "nodebuffer" });
}

/**
 * 构造当前场景的标准初始数据。
 */
async function create_nav_epub_fixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
  );
  zip.file(
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
  zip.file(
    "OPS/nav.xhtml",
    `<html><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">第一章</a></li></ol></nav></body></html>`,
  );
  zip.file("OPS/chapter.xhtml", "<html><body><p>章节</p></body></html>");
  return zip.generateAsync({ compression: "STORE", type: "nodebuffer" });
}

/**
 * 构造带真实 NBSP 的 XHTML，覆盖 XML 输出实体合法性
 */
async function create_nbsp_xhtml_epub_fixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
  );
  zip.file(
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
  zip.file(
    "OPS/chapter.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><p>\u00a0</p><p>章节</p></body>
</html>`,
  );
  return zip.generateAsync({ compression: "STORE", type: "nodebuffer" });
}

/**
 * 构造无 XHTML 命名空间的普通 HTML，覆盖 HTML 输出行为
 */
async function create_plain_html_epub_fixture(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>`,
  );
  zip.file(
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
  zip.file("OPS/chapter.html", "<html><body><p>章节</p></body></html>");
  return zip.generateAsync({ compression: "STORE", type: "nodebuffer" });
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
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const item = await create_translated_epub_item(epub_asset, "译文");
    const translated_path = path.join(temp_dir, "translated", "book.epub");
    const bilingual_path = path.join(temp_dir, "bilingual", "book.epub");

    await writer.build_epub(epub_asset, [item], translated_path, false);
    await writer.build_epub(epub_asset, [item], bilingual_path, true);

    await expect(read_epub_entry_text(fs.readFileSync(translated_path))).resolves.toContain("译文");
    await expect(read_epub_entry_text(fs.readFileSync(bilingual_path))).resolves.toContain("章节");
    await expect(read_epub_entry_text(fs.readFileSync(bilingual_path))).resolves.toContain("译文");
  });

  it("block_text 写回普通译文时移除 rt，双语原文块保留原始 ruby DOM", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture(
      '<ruby class="calibre3">宝<rt>ほう</rt>條<rt>じょう</rt>直<rt>なお</rt>希<rt>き</rt></ruby>',
    );
    const item = await create_translated_epub_item(epub_asset, "宝条直希");
    const translated_path = path.join(temp_dir, "ruby-translated", "book.epub");
    const bilingual_path = path.join(temp_dir, "ruby-bilingual", "book.epub");

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
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("<ruby>A <rt>x</rt></ruby> B");
    const item = await create_translated_epub_item(epub_asset, "译文");
    const translated_path = path.join(temp_dir, "ruby-space-translated", "book.epub");

    await writer.build_epub(epub_asset, [item], translated_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(translated_path))).resolves.toContain("译文");
  });

  it("回归 EPUB issue：双语写回保留目录链接指向原有章节文件", async () => {
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
    const out_path = path.join(temp_dir, "nav-bilingual", "book.epub");

    await writer.build_epub(epub_asset, items, out_path, true);

    const nav_text = await read_epub_entry_text(fs.readFileSync(out_path), "OPS/nav.xhtml");
    expect(nav_text).toContain('href="chapter.xhtml"');
  });

  it("AST 写回保留 XML 合法补充平面字符", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const item = await create_translated_epub_item(epub_asset, "译文😀𠀀");
    const out_path = path.join(temp_dir, "supplementary", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    await expect(read_epub_entry_text(fs.readFileSync(out_path))).resolves.toContain("译文😀𠀀");
  });

  it("AST 写回 XHTML 时把真实 NBSP 输出为 XML 合法内容", async () => {
    const writer = create_writer();
    const epub_asset = await create_nbsp_xhtml_epub_fixture();
    const item = await create_translated_epub_item_by_src(epub_asset, "章节", "译文");
    const out_path = path.join(temp_dir, "nbsp-ast", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path));

    expect(written_text).not.toContain("&nbsp;");
    expect(written_text).toMatch(/&#x?a0;|&#160;|\u00a0/iu);
    expect(() => new EpubAst().parse_xml_document(written_text)).not.toThrow();
  });

  it("缺少 AST metadata 时回退 legacy 顺序写回", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const out_path = path.join(temp_dir, "legacy", "book.epub");
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
    const writer = create_writer();
    const epub_asset = await create_nbsp_xhtml_epub_fixture();
    const out_path = path.join(temp_dir, "nbsp-legacy", "book.epub");
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
    const writer = create_writer();
    const epub_asset = await create_plain_html_epub_fixture();
    const item = await create_translated_epub_item_by_src(epub_asset, "章节", "译文");
    const out_path = path.join(temp_dir, "plain-html", "book.epub");

    await writer.build_epub(epub_asset, [item], out_path, false);

    const written_text = await read_epub_entry_text(fs.readFileSync(out_path), "OPS/chapter.html");

    expect(written_text).toContain("译文");
    expect(written_text).not.toMatch(/^<\?xml/iu);
  });

  it("legacy 写回按字面量保留 replacement 特殊美元序列", async () => {
    const writer = create_writer();
    const epub_asset = await create_epub_fixture("章节");
    const out_path = path.join(temp_dir, "legacy-special-dollar", "book.epub");
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
      const writer = create_writer(target_language);
      const epub_asset = await create_layout_epub_fixture();
      const out_path = path.join(temp_dir, `layout-${target_language}`, "book.epub");
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
    const writer = create_writer("ZH-HANT");
    const epub_asset = await create_layout_epub_fixture();
    const item = await create_translated_epub_item(epub_asset, "译文");
    const out_path = path.join(temp_dir, "layout-ast", "book.epub");

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
    const writer = create_writer("ZH");
    const epub_asset = await create_layout_epub_fixture();
    const out_path = path.join(temp_dir, "layout-clean", "book.epub");
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
