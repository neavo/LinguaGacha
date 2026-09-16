import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as mupdf from "mupdf";
import type { PDFDocument, PDFRegion } from "../../../../shared/pdf";
import { render_pdf_translation, render_pdf_html } from "./pdf-translation";

const PDF_MAX_PIXELS = 32_000_000;
const PDF_COORDINATE_DECIMALS = 6;

/** 原稿身份由字节决定；阅读和渲染共用旋转后的左上角页面坐标。 */
export function read_pdf_document(bytes: Uint8Array): PDFDocument {
  const pdf = new mupdf.PDFDocument(bytes);
  try {
    const trailer = pdf.getTrailer();
    const labels = trailer.get("Root", "PageLabels");
    const has_labels = !labels.isNull();
    labels.destroy();
    trailer.destroy();
    const pages: PDFDocument["source"]["pages"] = [];
    for (let index = 0; index < pdf.countPages(); index++) {
      const page = pdf.loadPage(index);
      try {
        const [x0, y0, x1, y1] = page.getBounds();
        const object = page.getObject();
        const rotate = object.getInheritable("Rotate");
        const rotation = ((rotate.asNumber() % 360) + 360) % 360;
        rotate.destroy();
        object.destroy();
        pages.push({
          number: index + 1,
          width: x1 - x0,
          height: y1 - y0,
          rotation,
          label: has_labels ? page.getLabel() : null,
        });
      } finally {
        page.destroy();
      }
    }
    if (pages.length === 0) throw new Error("PDF has no pages.");
    return {
      source: { digest: createHash("sha256").update(bytes).digest("hex"), pages },
      translation: null,
    };
  } finally {
    pdf.destroy();
  }
}

/** 文档由调用者持有，可连续渲染多页；只分配目标裁剪区域的像素。 */
export function render_pdf_page(
  pdf: mupdf.PDFDocument,
  request: { page: number; scale: number; region?: PDFRegion },
): Uint8Array {
  if (!Number.isInteger(request.page) || request.page < 1 || request.page > pdf.countPages())
    throw new Error("PDF page is outside the document.");
  const page = pdf.loadPage(request.page - 1);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const { scale } = request;
    const region = request.region ?? {
      page: request.page,
      x: 0,
      y: 0,
      width: x1 - x0,
      height: y1 - y0,
    };
    if (
      ![scale, region.x, region.y, region.width, region.height].every(Number.isFinite) ||
      scale <= 0 ||
      region.page !== request.page ||
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > x1 - x0 + 1e-6 ||
      region.y + region.height > y1 - y0 + 1e-6
    )
      throw new Error("PDF region is outside its page.");
    const width = Math.ceil(region.width * scale);
    const height = Math.ceil(region.height * scale);
    if (width * height > PDF_MAX_PIXELS)
      throw new Error("PDF render exceeds pixel limit. Reduce scale or crop the page.");
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
    try {
      pixmap.clear(255);
      const device = new mupdf.DrawDevice(
        [scale, 0, 0, scale, -(x0 + region.x) * scale, -(y0 + region.y) * scale],
        pixmap,
      );
      try {
        page.run(device, mupdf.Matrix.identity);
        device.close();
      } finally {
        device.destroy();
      }
      return pixmap.asPNG();
    } finally {
      pixmap.destroy();
    }
  } finally {
    page.destroy();
  }
}

export type BuildPDFDocumentArgs = {
  title: string;
  document: PDFDocument;
  source_bytes: Uint8Array;
  print: (html: string) => Promise<Uint8Array>;
  signal?: AbortSignal;
};

/** 以原稿副本为输出，保留原页对象及批注。预览和正式导出共用这个入口。 */
export async function build_pdf_document(args: BuildPDFDocumentArgs): Promise<Uint8Array> {
  args.signal?.throwIfAborted();
  const { source, translation } = args.document;
  const rendered = translation ? render_pdf_translation(translation, source) : [];
  if (!translation?.sections.length) return args.source_bytes;
  const output = new mupdf.PDFDocument(args.source_bytes);
  try {
    const order: number[] = []; // 组合完成前保存原页索引，最后一次重排保持引用有效。
    let next_page = 0;
    for (let index = 0; index < translation.sections.length;) {
      args.signal?.throwIfAborted();
      const section = translation.sections[index]!;
      while (next_page < section.page_start - 1) order.push(next_page++);
      if (section.kind === "omit") {
        next_page = section.page_end;
        index++;
        continue;
      }
      const size = source.pages[section.page_start - 1]!;
      const group = [rendered[index]!];
      let end = section.page_end;
      index++;
      while (
        index < translation.sections.length &&
        translation.sections[index]!.page_start === end + 1
      ) {
        const next = translation.sections[index]!;
        const next_size = source.pages[next.page_start - 1]!;
        if (
          next.kind !== "translate" ||
          next_size.width !== size.width ||
          next_size.height !== size.height ||
          !isDeepStrictEqual(next.background, section.background)
        )
          break;
        group.push(rendered[index]!);
        end = translation.sections[index++]!.page_end;
      }
      const html = await render_pdf_html({
        title: args.title,
        size,
        rendered: group,
        renderImage: async (region) => {
          args.signal?.throwIfAborted();
          return render_pdf_page(output, { page: region.page, scale: 2, region });
        },
      });
      const bytes = await args.print(html);
      args.signal?.throwIfAborted();
      const printed = new mupdf.PDFDocument(bytes);
      const map = output.newGraftMap();
      try {
        if (section.background) {
          const image = new mupdf.Image(
            render_pdf_page(output, {
              page: section.background.page,
              scale: 2,
              region: section.background,
            }),
          );
          try {
            apply_pdf_background(printed, image);
          } finally {
            image.destroy();
          }
        }
        const offset = output.countPages();
        for (let page = 0; page < printed.countPages(); page++) {
          map.graftPage(-1, printed, page);
          order.push(offset + page);
        }
        // graftPage 不复制链接。所有目标页存在后重建外链和打印文档内的跳转。
        for (let index = 0; index < printed.countPages(); index++) {
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
      next_page = end;
    }
    while (next_page < source.pages.length) order.push(next_page++);
    args.signal?.throwIfAborted();
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

/** 在实际输出页底层绘制背景，页面裁切负责出血；一组页面共享一个图像对象。 */
function apply_pdf_background(pdf: mupdf.PDFDocument, image: mupdf.Image): void {
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
