import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as mupdf from "mupdf";
import type { PDFDocument, PDFRegion, PDFPage } from "../../../../shared/pdf";
import {
  is_pdf_original_page,
  render_pdf_translation,
  render_pdf_html,
  render_pdf_page_translation,
} from "./pdf-translation";

const PDF_MAX_PIXELS = 32_000_000;
const PDF_COORDINATE_DECIMALS = 6;
const PDF_PREVIEW_MAX_EDGE = 1600;

/** 原稿身份由字节决定；阅读和渲染共用旋转后的左上角页面坐标。 */
export function read_pdf_document(bytes: Uint8Array): PDFDocument {
  const pdf = new mupdf.PDFDocument(bytes);
  try {
    const trailer = pdf.getTrailer();
    const labels = trailer.get("Root", "PageLabels");
    const has_labels = !labels.isNull();
    labels.destroy();
    trailer.destroy();
    const pages: PDFDocument["pages"] = [];
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
          page: index + 1,
          width: x1 - x0,
          height: y1 - y0,
          rotation,
          label: has_labels ? page.getLabel() : null,
          translation: null,
          reviewed: false,
          notes: "",
        });
      } finally {
        page.destroy();
      }
    }
    if (pages.length === 0) throw new Error("PDF has no pages.");
    return {
      digest: createHash("sha256").update(bytes).digest("hex"),
      pages,
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
  const document = args.document;
  const rendered = render_pdf_translation(document); // 原页直出也先校验处置理由和文档结构。
  if (document.pages.every(is_pdf_original_page)) return args.source_bytes;
  const output = new mupdf.PDFDocument(args.source_bytes);
  try {
    const order: number[] = []; // 最后一次重排保留原页对象与批注。
    for (let index = 0; index < document.pages.length;) {
      args.signal?.throwIfAborted();
      const page = document.pages[index]!;
      const translation = page.translation;
      if (is_pdf_original_page(page)) {
        order.push(index++);
        continue;
      }
      if (translation?.kind !== "translate" || rendered[index] === null) {
        index++;
        continue;
      }
      // 有正文才发起打印；空译稿不生成空白页，也不打断兼容的连续正文。
      const size = page;
      const group = [rendered[index++]!];
      while (index < document.pages.length) {
        const next = document.pages[index]!;
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
        group.push(rendered[index++]!);
      }
      const printed = await print_pdf_group(args, output, size, group, translation.background);
      const map = output.newGraftMap();
      try {
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
    }
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

/** 共用排版和背景，保留完整来源；返回文档由调用方释放，导出可直接接页而无需中间序列化。 */
async function print_pdf_group(
  args: BuildPDFDocumentArgs,
  source: mupdf.PDFDocument,
  size: PDFPage,
  rendered: NonNullable<ReturnType<typeof render_pdf_page_translation>>[],
  background: PDFRegion | undefined,
): Promise<mupdf.PDFDocument> {
  const html = await render_pdf_html({
    title: args.title,
    size,
    rendered,
    renderImage: async (region) => {
      args.signal?.throwIfAborted();
      return render_pdf_page(source, { page: region.page, scale: 2, region });
    },
  });
  const bytes = await args.print(html);
  args.signal?.throwIfAborted();
  const printed = new mupdf.PDFDocument(bytes);
  try {
    if (background) {
      const image = new mupdf.Image(
        render_pdf_page(source, { page: background.page, scale: 2, region: background }),
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

/** 单页译稿允许没有输出；调用方先按处置状态展示空态。 */
export async function build_pdf_page_preview(
  args: BuildPDFDocumentArgs & { page: number },
): Promise<Uint8Array> {
  const page = args.document.pages[args.page - 1];
  if (!page) throw new Error("PDF page does not exist.");
  const rendered = render_pdf_page_translation(page, args.document);
  if (!rendered || page.translation?.kind !== "translate")
    throw new Error("PDF page has no translation output.");
  const source = new mupdf.PDFDocument(args.source_bytes);
  try {
    const printed = await print_pdf_group(
      args,
      source,
      page,
      [rendered],
      page.translation.background,
    );
    try {
      const buffer = printed.saveToBuffer("garbage=1,compress");
      try {
        return new Uint8Array(buffer.asUint8Array());
      } finally {
        buffer.destroy();
      }
    } finally {
      printed.destroy();
    }
  } finally {
    source.destroy();
  }
}

/** 页数收缩时夹取到末页，按预览尺寸上限输出图像和实际页码。 */
export function render_pdf_preview(
  bytes: Uint8Array,
  page: number,
): { image: string; count: number; page: number } {
  const document = new mupdf.PDFDocument(bytes);
  try {
    page = Math.min(page, document.countPages());
    const target = document.loadPage(page - 1);
    let scale: number;
    try {
      const [x0, y0, x1, y1] = target.getBounds();
      scale = Math.min(2, PDF_PREVIEW_MAX_EDGE / Math.max(x1 - x0, y1 - y0));
    } finally {
      target.destroy();
    }
    return {
      image: `data:image/png;base64,${Buffer.from(render_pdf_page(document, { page, scale })).toString("base64")}`,
      count: document.countPages(),
      page,
    };
  } finally {
    document.destroy();
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
