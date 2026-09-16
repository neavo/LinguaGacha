/** 区域使用旋转后、scale=1 的页面坐标，原点在左上角。 */
export type PDFRegion = { page: number; x: number; y: number; width: number; height: number };
/** 页身份来自原稿，跨页译稿不改变页身份。 */
export type PDFPage = {
  number: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
};
/** 每段译稿替换完整的原页闭区间；范围按原页顺序排列且互不重叠。 */
export type PDFTranslationSection = {
  page_start: number;
  page_end: number;
  markdown: string;
};
export type PDFTranslation = {
  sections: PDFTranslationSection[];
  reviewed_pages: number[]; // Agent 的核对记录，不作为语义完整性的机器证明
  notes: string; // 重开工程后仍可使用的续做说明
};
export type PDFDocument = {
  source: { digest: string; pages: PDFPage[] };
  translation: PDFTranslation | null;
};
export type PDFSummary = {
  pages: number;
  reviewed_pages: number;
  translated_pages: number; // 译稿覆盖的原页数，不是输出 PDF 的页数
};
export type PDFDocumentRecord = { file_path: string; document: PDFDocument };

/** 只跨宿主传递文档字节或应用生成的 HTML，最终落盘归后端。 */
export type PDFHostOperation = { kind: "print_pdf"; html: string };
export type PDFHost = (operation: PDFHostOperation, signal?: AbortSignal) => Promise<Uint8Array>;
