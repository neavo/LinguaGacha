import { createHash } from "node:crypto";
import * as mupdf from "mupdf";

const PDF_MAX_PIXELS = 32_000_000; // 分配位图前限制像素总量，约束单页渲染内存。

/** 文本视图引用 MuPDF 内存，复制内容后释放。 */
function extract_text(page) {
  const text = page.toStructuredText("");
  try {
    return text.asText().trim();
  } finally {
    text.destroy();
  }
}

/** 原稿身份由字节决定。阅读和渲染共用旋转后的左上角页面坐标。 */
export function read_pdf_document(bytes) {
  const pdf = new mupdf.PDFDocument(bytes);
  try {
    const page_count = pdf.countPages();
    if (page_count === 0) throw new Error("PDF has no pages.");
    const trailer = pdf.getTrailer();
    const labels = trailer.get("Root", "PageLabels");
    const has_labels = !labels.isNull();
    labels.destroy();
    trailer.destroy();
    const pages = [];
    for (let index = 0; index < page_count; index++) {
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
          text: extract_text(page),
        });
      } finally {
        page.destroy();
      }
    }
    return {
      digest: createHash("sha256").update(bytes).digest("hex"),
      pages,
    };
  } finally {
    pdf.destroy();
  }
}

/** 从独立字节打开原稿，供单页调查和预览。 */
export function render_pdf_page(bytes, request) {
  const pdf = new mupdf.PDFDocument(bytes);
  try {
    return render_pdf_page_from_document(pdf, request);
  } finally {
    pdf.destroy();
  }
}

/** 包内批量渲染复用同一文档，只分配目标裁剪区域的像素。 */
export function render_pdf_page_from_document(pdf, request) {
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
