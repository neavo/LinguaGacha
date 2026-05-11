import fs from "node:fs";

import JSZip from "jszip";

/**
 * 构造最小 EPUB，测试只依赖公开 zip/container/opf/spine 结构。
 */
export async function create_epub_fixture(chapter_text: string): Promise<Buffer> {
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
  <body><p>${chapter_text}</p></body>
</html>`,
  );
  return zip.generateAsync({ compression: "STORE", type: "nodebuffer" });
}

/**
 * 写出最小 EPUB 文件，服务层测试通过真实磁盘入口覆盖公开预演行为。
 */
export async function write_epub_fixture(file_path: string, chapter_text: string): Promise<void> {
  fs.writeFileSync(file_path, await create_epub_fixture(chapter_text));
}

/**
 * 读取 EPUB 内指定文档文本，断言写回结果时不暴露 JSZip 细节到各测试文件。
 */
export async function read_epub_entry_text(
  epub_content: Buffer | Uint8Array,
  entry_path = "OPS/chapter.xhtml",
): Promise<string> {
  const zip = await JSZip.loadAsync(epub_content);
  return (await zip.file(entry_path)?.async("string")) ?? "";
}
