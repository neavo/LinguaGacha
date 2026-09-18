import { parentPort } from "node:worker_threads";
import {
  build_pdf_document,
  read_pdf_document,
  build_pdf_page_preview,
  render_pdf_preview,
} from "./pdf-document";
import { to_log_error } from "../../../../shared/error";
import type { PDFWorkerRequest, PDFWorkerResponse } from "./pdf-worker";

// 父端串行派发文档，每次只等待一份打印结果。
let printing: { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void } | null =
  null;
/** 转移最终 PDF 的独占字节，文档描述按结构化消息复制。 */
const send = (message: PDFWorkerResponse): void => {
  const transfer =
    message.kind === "result" && message.result instanceof Uint8Array
      ? [message.result.buffer as ArrayBuffer]
      : [];
  parentPort!.postMessage(message, transfer);
};

// 父端只派发一个活动文档；打印期间保留该文档，图片渲染不跨进程。
parentPort!.on("message", async (message: PDFWorkerRequest) => {
  if (message.kind !== "task") {
    if (message.kind === "printed") printing?.resolve(message.bytes);
    else printing?.reject(new Error(message.error.message, { cause: message.error }));
    printing = null;
    return;
  }
  try {
    const task = message.task;
    const result =
      task.kind === "render"
        ? render_pdf_preview(task.bytes, task.page)
        : task.kind === "read"
          ? read_pdf_document(task.bytes)
          : await (task.kind === "preview" ? build_pdf_page_preview : build_pdf_document)({
              page: task.kind === "preview" ? task.page : 1,
              title: task.title,
              document: task.document,
              source_bytes: task.bytes,
              print: (html) =>
                new Promise<Uint8Array>((resolve, reject) => {
                  printing = { resolve, reject };
                  send({ kind: "print", html });
                }),
            });
    send({ kind: "result", result });
  } catch (error) {
    send({ kind: "error", error: to_log_error(error) });
  }
});
