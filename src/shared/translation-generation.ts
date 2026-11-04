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
  output_directory?: string; // 手动选择的父目录，缺省时由后端按应用设置确定。
};
export type TranslationFileGenerationResult = {
  accepted: true;
  output_path: string;
  bilingual_output_path: string;
  generic_input_path?: string; // 暂存生成的通用写回输入，尚未还原为目标格式。
  pdf_files: PDFFileGenerationResult[];
};

export type TranslationOutputPaths = {
  manual: boolean; // 未传父目录且应用要求手动选择，调用方须先询问。
  translated_path: string;
  bilingual_path: string;
};
