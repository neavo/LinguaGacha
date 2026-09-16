import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import type { PDFHost } from "../../../shared/pdf";
import type { WorkspaceHostPort } from "./runtime/host-contract";

/** 宿主只补齐 HTML 打印和工程交付，PDF 计算在工作区进程中执行。 */
export function create_workspace_host(options: {
  root: string;
  nativeFs: NativeFs;
  pdfHost?: PDFHost;
  exportPDF: (
    file_path: string,
    fp: string,
    signal: AbortSignal,
  ) => Promise<{ output_path: string }>;
}): WorkspaceHostPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (request.kind === "export_pdf")
      return await options.exportPDF(request.file_path, request.fp, signal);
    if (!options.pdfHost) throw new Error("PDF host unavailable.");
    const bytes = await options.pdfHost({ kind: "print_pdf", html: request.html }, signal);
    signal.throwIfAborted();
    const output = `work/${randomUUID()}.pdf`;
    await options.nativeFs.write_file(path.join(options.root, output), bytes);
    return { path: output };
  };
}
