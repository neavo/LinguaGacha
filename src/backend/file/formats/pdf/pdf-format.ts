import path from "node:path";
import type { PDFDocument, PDFDocumentRecord } from "../../../../shared/pdf";
import { is_pdf_original_page } from "./pdf-translation";
import { write_binary_file, type FileFormatWriteContext } from "../file-format-shared";
import type { PDFExecution } from "./pdf-worker";
import { AppError } from "../../../../shared/error";

/** 导入只提取可确定事实，不判断阅读顺序，也不发起模型请求。 */
export class PDFFormat {
  /** 计算端口由组合根注入，格式层负责资产读取和最终落盘。 */
  public constructor(private readonly execute: PDFExecution) {}

  /** 导出服务已校验文档；全部输出原页时省去计算线程，其余由线程组合。 */
  public async write_to_path(
    documents: readonly PDFDocumentRecord[],
    context: FileFormatWriteContext & { signal?: AbortSignal },
  ): Promise<void> {
    for (const { file_path, document } of documents) {
      const bytes = context.asset_reader(file_path);
      if (bytes === null) throw new AppError("file.not_found");
      const output = document.pages.every(is_pdf_original_page)
        ? bytes
        : await this.execute(
            { kind: "build", title: path.basename(file_path), document, bytes },
            context.signal,
          );
      if (!(output instanceof Uint8Array)) throw new TypeError("Invalid PDF output.");
      context.signal?.throwIfAborted();
      await write_binary_file(path.join(context.paths.translated_path, file_path), output);
    }
  }

  /** 返回独立文档，PDF 页面不进入文本 Item 管线。 */
  public async read_from_stream(content: Uint8Array): Promise<PDFDocument> {
    const document = await this.execute({ kind: "read", bytes: content });
    if (document instanceof Uint8Array) throw new TypeError("Invalid PDF document.");
    return document;
  }
}
