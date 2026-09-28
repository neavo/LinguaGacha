import type { Static } from "typebox";
import type {
  PDF_REGION_SCHEMA,
  PDF_PAGE_SCHEMA,
  PDF_PAGE_UPDATE_SCHEMA,
  PDF_DOCUMENT_SCHEMA,
} from "./pdf-schema";

/** 区域使用旋转后、scale=1 的页面坐标，原点在左上角。 */
export type PDFRegion = Static<typeof PDF_REGION_SCHEMA>;
/** 页身份来自原稿；结构与持久化校验共用同一 Schema。 */
export type PDFPage = Static<typeof PDF_PAGE_SCHEMA>;
/** 整页替换的可修改事实；空译稿接管原页，但不生成独立正文。 */
export type PDFPageUpdate = Static<typeof PDF_PAGE_UPDATE_SCHEMA>;
/** null 待处理，translate 接管原页，keep 保留，omit 省略。 */
export type PDFPageTranslation = PDFPageUpdate["translation"];
/** 文档按原稿页组织，跨页译稿不改变页身份。 */
export type PDFDocument = Static<typeof PDF_DOCUMENT_SCHEMA>;
export type PDFSummary = {
  pages: number;
  translated_pages: number; // 译稿覆盖的原页数，不是输出 PDF 的页数
  kept_pages: number; // 已确认无需翻译并保留原页
  omitted_pages: number;
};
export type PDFDocumentRecord = { file_path: string; document: PDFDocument };
export type PDFPageRecord = { file_path: string; page: PDFPage };

/** 只跨宿主传递文档字节或应用生成的 HTML，最终落盘归后端。 */
export type PDFHostOperation = { kind: "print_pdf"; html: string };
export type PDFHost = (operation: PDFHostOperation, signal?: AbortSignal) => Promise<Uint8Array>;
