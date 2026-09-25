import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import type { PDFHost } from "../../../shared/pdf";
import type { WorkspaceHostPort } from "./runtime/host-contract";

/** 宿主补齐 HTML 打印，PDF 计算在工作区进程中执行。 */
export function create_workspace_host(options: {
  root: string;
  nativeFs: NativeFs;
  pdfHost?: PDFHost | undefined;
}): WorkspaceHostPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!options.pdfHost) throw new Error("PDF host unavailable.");
    const bytes = await options.pdfHost({ kind: "print_pdf", html: request.html }, signal);
    // 宿主可能在取消后才完成打印，落盘前再次检查，避免停止后产生新工作文件。
    signal.throwIfAborted();
    const output = `work/${randomUUID()}.pdf`;
    await options.nativeFs.write_file(path.join(options.root, output), bytes);
    return { path: output };
  };
}
