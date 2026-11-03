import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import type { PDFHost } from "../../../shared/pdf";
import { Check } from "typebox/value";
import { AGENT_WORKSPACE_WORK_ROOT } from "../workspace/runtime/policy";
import { Type, type Static } from "@earendil-works/pi-ai";
/** 父进程在打印 HTML 前校验脚本请求。 */
export const WORKSPACE_PRINT_PDF_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("print_pdf"),
    html: Type.String(),
  },
  { additionalProperties: false },
);
export type WorkspacePrintPDFRequest = Static<typeof WORKSPACE_PRINT_PDF_REQUEST_SCHEMA>;
export type WorkspacePrintPDFResult = { path: string }; // 宿主返回本机绝对路径，脚本切换 cwd 不改变文件身份。
export type WorkspacePrintPDFPort = (
  request: WorkspacePrintPDFRequest,
  signal: AbortSignal,
) => Promise<WorkspacePrintPDFResult>;

/** 宿主补齐 HTML 打印，PDF 计算在工作区进程中执行。 */
export function create_pdf_printer(options: {
  root: string;
  nativeFs: NativeFs;
  pdfHost?: PDFHost | undefined;
}): WorkspacePrintPDFPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!options.pdfHost) throw new Error("PDF host unavailable.");
    const bytes = await options.pdfHost({ kind: "print_pdf", html: request.html }, signal);
    // 宿主可能在取消后才完成打印，落盘前再次检查，避免停止后产生新工作文件。
    signal.throwIfAborted();
    const output = path.resolve(options.root, AGENT_WORKSPACE_WORK_ROOT, `${randomUUID()}.pdf`);
    await options.nativeFs.write_file(output, bytes);
    return { path: output };
  };
}

/** 父进程在工具入口校验脚本提供的宿主请求。 */
export async function execute_print_pdf_request(
  request: unknown,
  signal: AbortSignal,
  host: WorkspacePrintPDFPort | undefined,
) {
  if (!Check(WORKSPACE_PRINT_PDF_REQUEST_SCHEMA, request))
    throw new Error("Invalid workspace print_pdf request.");
  if (!host) throw new Error("PDF printer unavailable.");
  return await host(request, signal);
}
