import { Type, type Static } from "typebox";
import { IMAGE_OUTPUT_REPORT_SCHEMA } from "./image";

/** 这些资产仍需要 Agent 完成目标格式处理。 */
export function requires_agent_generation(file_type: string): boolean {
  return file_type === "GENERIC" || file_type === "MEDIA";
}

/** 每个 PDF 的覆盖按原页计数，与重排后的输出页数独立。 */
const COUNT = Type.Integer({ minimum: 0 });
export const PDF_FILE_GENERATION_RESULT_SCHEMA = Type.Object(
  {
    file_path: Type.String(),
    written: Type.Boolean(), // 整份省略时正常完成且没有输出文件。
    translated_pages: COUNT,
    original_pages: COUNT, // 实际输出的原稿页，包含待处理与确认保留页
    omitted_pages: COUNT,
  },
  { additionalProperties: false },
);
export type PDFFileGenerationResult = Static<typeof PDF_FILE_GENERATION_RESULT_SCHEMA>;
export type TranslationFileGenerationRequest = {
  project_path: string; // 发起生成时的工程身份，后端校验后才读取工程。
  expected_section_revisions: { files: number }; // 用户确认的文件集合，译文采用执行时的保存值。
  output_directory?: string; // 手动选择的父目录，缺省时由后端按应用设置确定。
};
export const TRANSLATION_FILE_GENERATION_RESULT_SCHEMA = Type.Object(
  {
    accepted: Type.Literal(true),
    output_path: Type.String(),
    bilingual_output_path: Type.String(), // 双语成果的目标位置，未生成双语时目录不存在。
    excluded_files: Type.Array(Type.String()),
    writeback: Type.Optional(
      Type.Object(
        { input_path: Type.String(), files: Type.Array(Type.String()) },
        { additionalProperties: false },
      ),
    ), // 已提供输入，仍需 Agent 完成目标格式处理。
    image_report: Type.Optional(IMAGE_OUTPUT_REPORT_SCHEMA),
    pdf_files: Type.Array(PDF_FILE_GENERATION_RESULT_SCHEMA),
  },
  { additionalProperties: false },
);
export type TranslationFileGenerationResult = Static<
  typeof TRANSLATION_FILE_GENERATION_RESULT_SCHEMA
>;

export const TRANSLATION_OUTPUT_PATHS_SCHEMA = Type.Object(
  {
    manual: Type.Boolean(), // 未传父目录且应用要求手动选择，调用方须先询问。
    translated_path: Type.String(),
    bilingual_path: Type.String(),
  },
  { additionalProperties: false },
);
export type TranslationOutputPaths = Static<typeof TRANSLATION_OUTPUT_PATHS_SCHEMA>;
