/** 每个 PDF 的覆盖按原页计数，与重排后的输出页数独立。 */
export type PDFFileExportResult = {
  file_path: string;
  translated_pages: number;
  original_pages: number; // 实际输出的原稿页，包含待处理与确认保留页
  omitted_pages: number;
};
export type TranslationFileExportResult = {
  accepted: true;
  output_path: string;
  bilingual_output_path?: string;
  pdf_files: PDFFileExportResult[];
};
