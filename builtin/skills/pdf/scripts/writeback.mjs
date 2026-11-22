import { isDeepStrictEqual } from "node:util";
import * as mupdf from "mupdf";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { printPdf } from "@lg/pdf";
import { read_generic_items } from "@lg/generic";
import { render_pdf_page_from_document } from "./document.mjs";
import { render_pdf_translation, render_pdf_html } from "./markdown.mjs";

const PDF_COORDINATE_DECIMALS = 6; // PDF 内容流只允许十进制数字。

/** 保留 JSON 解码与条目契约检查各自的错误。 */
async function read_json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/** 使用当前生成快照的正文和源包中固定的页面定位。 */
export async function build({ directory, itemsPath, output, signal }) {
  const [source_bytes, metadata, source, writeback] = await Promise.all([
    readFile(path.join(directory, "source.pdf")),
    read_json(path.join(directory, "pdf.json")),
    read_json(path.join(directory, "items.json")).then(read_generic_items),
    read_json(itemsPath).then(read_generic_items),
  ]);
  if (
    typeof metadata?.digest !== "string" ||
    typeof metadata?.original_file_name !== "string" ||
    source.length !== writeback.length ||
    !source.length
  )
    throw new Error("PDF source and writeback do not match.");
  // 写回与源记录按原始位置配对，页码可识别误选或重排的输入。
  const pages = source.map((record, index) => {
    const next = writeback[index];
    if (next.page !== record.page) throw new Error(`Invalid PDF item at row ${index}.`);
    const translation =
      record.omit === true
        ? { kind: "omit" }
        : next.message === record.message
          ? null
          : {
              kind: "translate",
              markdown: next.message,
              background: record.background ?? undefined,
            };
    return { ...record, translation };
  });
  // 原稿字节和摘要在封包时确定，摘要用于解析该包的图片引用。
  const bytes = await assemble_pdf({
    title: metadata.original_file_name,
    digest: metadata.digest,
    pages,
    source_bytes,
    signal,
  });
  if (bytes === null) return { path: null };
  await writeFile(output, bytes, { flag: "wx" });
  return { path: path.resolve(output) };
}

/** 未处理与确认保留共用原页直通。 */
function is_pdf_original_page(page) {
  return page.translation === null;
}

/** 以原稿副本为输出，预览与正式导出共用这一入口。 */
async function assemble_pdf({ pages, digest, source_bytes, title, signal }) {
  signal?.throwIfAborted();
  if (pages.every(is_pdf_original_page)) return source_bytes;
  const rendered = render_pdf_translation(pages, digest);
  // 所有页均无输出时返回空结果，格式层据此省略文件。
  if (!pages.some((page, index) => is_pdf_original_page(page) || rendered[index] !== null))
    return null;
  const output = new mupdf.PDFDocument(source_bytes);
  try {
    const order = []; // 最后一次重排保留原页对象与批注。
    for (let index = 0; index < pages.length;) {
      signal?.throwIfAborted();
      const page = pages[index];
      const translation = page.translation;
      if (is_pdf_original_page(page)) {
        order.push(index++);
        continue;
      }
      if (translation?.kind !== "translate" || rendered[index] === null) {
        index++;
        continue;
      }
      // 空译稿跳过打印，连续正文仍可合并排版。
      const size = page;
      const group = [rendered[index++]];
      while (index < pages.length) {
        const next = pages[index];
        if (next.translation?.kind !== "translate") break;
        if (rendered[index] === null) {
          index++;
          continue;
        }
        if (
          next.width !== size.width ||
          next.height !== size.height ||
          !isDeepStrictEqual(next.translation.background, translation.background)
        )
          break;
        group.push(rendered[index++]);
      }
      const printed = await print_pdf_group(output, size, group, translation.background, {
        title,
        signal,
      });
      const map = output.newGraftMap();
      try {
        const offset = output.countPages();
        const printed_count = printed.countPages();
        for (let page = 0; page < printed_count; page++) {
          map.graftPage(-1, printed, page);
          order.push(offset + page);
        }
        // graftPage 不复制链接。所有目标页存在后重建外链和打印文档内的跳转。
        for (let index = 0; index < printed_count; index++) {
          const page = printed.loadPage(index);
          const target = output.loadPage(offset + index);
          try {
            for (const link of page.getLinks()) {
              try {
                let uri = link.getURI();
                if (uri.startsWith("#")) {
                  const destination = printed.resolveLinkDestination(link);
                  if (destination.page < 0) continue; // 已失效的打印目标没有可迁移页。
                  destination.page += offset;
                  uri = output.formatLinkURI(destination);
                }
                target.createLink(link.getBounds(), uri).destroy();
              } finally {
                link.destroy();
              }
            }
          } finally {
            target.destroy();
            page.destroy();
          }
        }
      } finally {
        map.destroy();
        printed.destroy();
      }
    }
    signal?.throwIfAborted();
    output.rearrangePages(order);
    // 清除被替换原页的不可达对象，不进行流内容去重或图片重压缩。
    const buffer = output.saveToBuffer("garbage=1,compress");
    try {
      return new Uint8Array(buffer.asUint8Array());
    } finally {
      buffer.destroy();
    }
  } finally {
    output.destroy();
  }
}

/** 返回完整文档供调用方直接接页，避免中间序列化。调用方负责释放。 */
async function print_pdf_group(source, size, rendered, background, { title, signal }) {
  const html = render_pdf_html({
    title,
    size,
    rendered,
    renderImage: (region) =>
      render_pdf_page_from_document(source, { page: region.page, scale: 2, region }),
  });
  const bytes = await printPdf(html);
  signal?.throwIfAborted();
  const printed = new mupdf.PDFDocument(bytes);
  try {
    if (background) {
      const image = new mupdf.Image(
        render_pdf_page_from_document(source, {
          page: background.page,
          scale: 2,
          region: background,
        }),
      );
      try {
        apply_pdf_background(printed, image);
      } finally {
        image.destroy();
      }
    }
    return printed;
  } catch (error) {
    printed.destroy();
    throw error;
  }
}

/** 背景按页边界裁切。一组页面共享图像对象。 */
function apply_pdf_background(pdf, image) {
  const reference = pdf.addImage(image);
  try {
    for (let index = 0; index < pdf.countPages(); index++) {
      const page = pdf.loadPage(index);
      const object = page.getObject();
      const resources = object.getInheritable("Resources");
      const contents = object.get("Contents");
      const sequence = pdf.newArray();
      try {
        const [x0, y0, x1, y1] = page.getBounds();
        const width = x1 - x0;
        const height = y1 - y0;
        // 按覆盖比例缩放，页面边界负责裁切，图像纵横比保持原值。
        const scale = Math.max(width / image.getWidth(), height / image.getHeight());
        const w = image.getWidth() * scale;
        const h = image.getHeight() * scale;
        let xobjects = resources.get("XObject");
        if (xobjects.isNull()) {
          xobjects.destroy();
          xobjects = pdf.newDictionary();
          resources.put("XObject", xobjects);
        }
        try {
          xobjects.put("LGBackground", reference);
        } finally {
          xobjects.destroy();
        }
        object.put("Resources", resources);
        // PDF 数字不接受指数记法；比例缩放的浮点尾差必须以十进制写入内容流。
        const matrix = [w, 0, 0, h, x0 + (width - w) / 2, y0 + (height - h) / 2]
          .map((value) => value.toFixed(PDF_COORDINATE_DECIMALS))
          .join(" ");
        const stream = pdf.addStream(`q ${matrix} cm /LGBackground Do Q\n`, {});
        try {
          sequence.push(stream); // 背景先绘制，已有正文和插图继续覆盖它。
        } finally {
          stream.destroy();
        }
        if (contents.isArray()) {
          for (let i = 0; i < contents.length; i++) {
            const entry = contents.get(i);
            try {
              sequence.push(entry);
            } finally {
              entry.destroy();
            }
          }
        } else if (!contents.isNull()) sequence.push(contents);
        object.put("Contents", sequence);
      } finally {
        sequence.destroy();
        contents.destroy();
        resources.destroy();
        object.destroy();
        page.destroy();
      }
    }
  } finally {
    reference.destroy();
  }
}
