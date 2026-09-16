import { escapeText } from "entities";
import { Check } from "typebox/value";
import type { PDFDocument, PDFTranslation, PDFRegion } from "../../../../shared/pdf";
import { PDF_TRANSLATION_SCHEMA, validate_pdf_region } from "./pdf-source";
import { pdf_markdown, type PDFMarkdown } from "./pdf-markdown";
import styles from "./pdf-print.css?raw";

/** 返回值与 sections 同序；省略段没有正文。校验和编译始终共用此入口。 */
export function render_pdf_translation(
  translation: PDFTranslation,
  source: PDFDocument["source"],
): (PDFMarkdown | null)[] {
  if (!Check(PDF_TRANSLATION_SCHEMA, translation)) throw new Error("Invalid PDF translation.");
  if (translation.reviewed_pages.some((page) => page > source.pages.length))
    throw new Error("Reviewed page is outside the source document.");
  let previous_end = 0;
  let omitted = 0; // 按原页计数，拒绝最终没有任何页面的导出。
  const rendered = translation.sections.map((section) => {
    if (
      section.page_start <= previous_end ||
      section.page_end < section.page_start ||
      section.page_end > source.pages.length
    )
      throw new Error(
        "PDF translation ranges must be ordered, disjoint and inside the source document.",
      );
    previous_end = section.page_end;
    if (section.kind === "omit") {
      if (!section.reason.trim()) throw new Error("Omitted PDF pages require a reason.");
      omitted += section.page_end - section.page_start + 1;
      return null;
    }
    if (!section.markdown.trim()) throw new Error("PDF translation section must contain text.");
    if (section.background) validate_pdf_region(source, section.background);
    try {
      return pdf_markdown(section.markdown, source, `page-${section.page_start}-`);
    } catch (error) {
      throw new Error(
        `PDF pages ${section.page_start}-${section.page_end}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
  if (omitted === source.pages.length) throw new Error("PDF output must retain at least one page.");
  return rendered;
}

/** 正文按原稿可见尺寸打印；宿主提供字体与 KaTeX 样式，文档层只拥有排版。 */
export async function render_pdf_html(args: {
  title: string;
  size: { width: number; height: number };
  rendered: readonly PDFMarkdown[];
  renderImage: (region: PDFRegion) => Promise<Uint8Array>;
}): Promise<string> {
  let html = args.rendered.map((entry) => entry.html).join("\n");
  const images = new Map(args.rendered.flatMap((entry) => [...entry.images]));
  // 编译器已将引用收窄为摘要与数值坐标，可直接匹配属性值。
  for (const [reference, region] of images) {
    const bytes = await args.renderImage(region);
    html = html.replaceAll(
      `src="${reference}"`,
      `src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}"`,
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(args.title)}</title><style>${styles}\n@page { size:${args.size.width}pt ${args.size.height}pt; } body { --pdf-page-height:${args.size.height}pt; }</style></head><body class="pdf-document">${html}</body></html>`;
}
