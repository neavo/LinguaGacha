import { AppError } from "../../../../shared/error";
import { extract_pdf_raw_document } from "./liteparse-extractor";
import { normalize_pdf_document } from "./pdf-semantic-normalizer";
import { write_pdf_semantic_markdown } from "./pdf-semantic-markdown-writer";

export type PdfDocumentReadResult = Readonly<{
  markdown: string;
}>;

/** PDF 读取的唯一编排入口，保证所有消费方共享同一语义投影。 */
export async function read_pdf_document(content: Uint8Array): Promise<PdfDocumentReadResult> {
  const raw = await extract_pdf_raw_document(content);
  const semantic = normalize_pdf_document(raw);
  const has_error = semantic.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const markdown = write_pdf_semantic_markdown(semantic);
  if (has_error || markdown.trim() === "") {
    throw new AppError("file.parse_failed", {
      diagnostic_context: {
        format: "PDF",
        reason: has_error ? "invalid_structure" : "no_extractable_text",
        diagnostics: semantic.diagnostics,
      },
    });
  }
  return {
    markdown,
  };
}
