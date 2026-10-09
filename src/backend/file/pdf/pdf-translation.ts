import { escapeText } from "entities";
import type { PDFDocument, PDFPage, PDFRegion } from "../../../shared/pdf";
import { validate_pdf_region, read_pdf_document } from "../../../shared/pdf-schema";
import { pdf_markdown, type PDFMarkdown } from "./pdf-markdown";
import styles from "./pdf-print.css?raw";

/** 待处理与确认保留都输出原页，完成率由页面处置另行统计。 */
export function is_pdf_original_page(page: PDFPage): boolean {
  return page.translation === null || page.translation.kind === "keep";
}

/** 调用方已校验载荷与页身份；这里独立编译正文、隔离引用，保存允许暂时没有输出页。 */
export function render_pdf_page_translation(
  page: PDFPage,
  source: PDFDocument,
): PDFMarkdown | null {
  const translation = page.translation;
  if (translation === null) return null;
  if (translation.kind !== "translate") {
    if (!translation.reason.trim())
      throw new Error(`PDF ${translation.kind} pages require a reason.`);
    return null;
  }
  if (translation.background) validate_pdf_region(source, translation.background);
  if (!translation.markdown.trim()) return null;
  try {
    return pdf_markdown(translation.markdown, source, `page-${page.page}-`);
  } catch (error) {
    throw new Error(
      `PDF page ${page.page}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** 预览和导出共用页级校验，空渲染结果交给构建入口表达无产物。 */
export function render_pdf_translation(document: PDFDocument): (PDFMarkdown | null)[] {
  read_pdf_document(document);
  return document.pages.map((page) => render_pdf_page_translation(page, document));
}

/** 正文按原稿可见尺寸打印；宿主提供字体与 KaTeX 样式，文档层只拥有排版。 */
export async function render_pdf_html(args: {
  title: string;
  size: { width: number; height: number };
  rendered: readonly PDFMarkdown[];
  renderImage: (region: PDFRegion) => Promise<Uint8Array>;
}): Promise<string> {
  const source_html = args.rendered.map((entry) => entry.html).join("\n");
  const images = new Map(args.rendered.flatMap((entry) => [...entry.images]));
  const image_data = new Map<string, string>();
  for (const [reference, region] of images) {
    const bytes = await args.renderImage(region);
    image_data.set(reference, `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  }
  // 只扫描原始 HTML，避免后续替换反复遍历已内嵌的 Base64 数据。
  const html = source_html.replace(/src="(pdf-image:[^"]+)"/g, (attribute, reference: string) => {
    const data = image_data.get(reference);
    return data === undefined ? attribute : `src="${data}"`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(args.title)}</title><style>${styles}\n@page { size:${args.size.width}pt ${args.size.height}pt; } body { --pdf-page-height:${args.size.height}pt; }</style></head><body class="pdf-document">${html}</body></html>`;
}
