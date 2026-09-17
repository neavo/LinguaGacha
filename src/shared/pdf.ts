/** 区域使用旋转后、scale=1 的页面坐标，原点在左上角。 */
export type PDFRegion = { page: number; x: number; y: number; width: number; height: number };
/** 页身份来自原稿，跨页译稿不改变页身份。 */
export type PDFPage = PDFPageUpdate & {
  page: number;
  width: number;
  height: number;
  rotation: number;
  label: string | null;
};
/** null 保留原页，translate 接管原页，omit 按明确理由跳过。 */
export type PDFPageTranslation =
  | null
  | { kind: "translate"; markdown: string; background?: PDFRegion }
  | { kind: "omit"; reason: string };
/** 整页替换的可修改事实；空译稿接管原页，但不生成独立正文。 */
export type PDFPageUpdate = {
  translation: PDFPageTranslation;
  reviewed: boolean; // 核对记录独立于译稿，不证明语义完整性
  notes: string; // 随该页保存的续做说明
};
/** 文档用于读取和导出组合，数据库按原页独立持久化。 */
export type PDFDocument = {
  digest: string;
  pages: PDFPage[];
};
export type PDFSummary = {
  pages: number;
  reviewed_pages: number;
  translated_pages: number; // 译稿覆盖的原页数，不是输出 PDF 的页数
  omitted_pages: number;
};
export type PDFDocumentRecord = { file_path: string; document: PDFDocument };
export type PDFPageRecord = { file_path: string; page: PDFPage };

/** 只跨宿主传递文档字节或应用生成的 HTML，最终落盘归后端。 */
export type PDFHostOperation = { kind: "print_pdf"; html: string };
export type PDFHost = (operation: PDFHostOperation, signal?: AbortSignal) => Promise<Uint8Array>;
