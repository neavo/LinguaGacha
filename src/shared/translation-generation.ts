/** 每个 PDF 的覆盖按原页计数，与重排后的输出页数独立。 */
export type PDFFileGenerationResult = {
  file_path: string;
  written: boolean; // 整份省略时正常完成且没有输出文件。
  translated_pages: number;
  original_pages: number; // 实际输出的原稿页，包含待处理与确认保留页
  omitted_pages: number;
};
export type TranslationFileGenerationRequest = {
  project_path: string; // 发起生成时的工程身份，后端校验后才读取工程。
  output_directory: string; // 前端确定的输出父目录，后端在其中创建译文目录。
};
export type TranslationFileGenerationResult = {
  accepted: true;
  output_path: string;
  bilingual_output_path?: string;
  pdf_files: PDFFileGenerationResult[];
};
