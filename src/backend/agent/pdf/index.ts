import { default_native_fs } from "../../../native/native-fs";
import { workspace_requests } from "../workspace/runtime/request-channel";
import { build_pdf_document, type BuildPDFDocumentArgs } from "../../file/pdf/pdf-document";
export {
  read_pdf_document as readPdfDocument,
  render_pdf_page as renderPdfPage,
} from "../../file/pdf/pdf-document";

export type BuildPdfDocumentArgs = Omit<BuildPDFDocumentArgs, "print">;

/** 工作区生成入口使用已绑定的宿主打印，共享排版实现仍由后端持有。 */
export function buildPdfDocument(args: BuildPdfDocumentArgs): Promise<Uint8Array | null> {
  return build_pdf_document({ ...args, print: printPdf });
}

/** 打印结果经临时文件传递，读取结束即释放该文件。 */
export async function printPdf(html: string): Promise<Uint8Array> {
  const result = await workspace_requests().call({ kind: "print_pdf", html });
  if (!result || typeof result !== "object" || !("path" in result))
    throw new Error("Invalid print_pdf response.");
  try {
    return new Uint8Array(default_native_fs.read_file(result.path));
  } finally {
    default_native_fs.unlink(result.path, { force: true }); // 文件已被移除时保留原始读取错误。
  }
}
