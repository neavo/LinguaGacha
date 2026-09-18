import { Worker } from "node:worker_threads";
import type { PDFDocument, PDFHost } from "../../../../shared/pdf";
import type { LogError } from "../../../../shared/error";
import { to_log_error } from "../../../../shared/error";

export type PDFTask =
  | { kind: "read"; bytes: Uint8Array }
  | { kind: "preview"; bytes: Uint8Array; title: string; document: PDFDocument; page: number }
  | { kind: "render"; bytes: Uint8Array; page: number }
  | { kind: "build"; bytes: Uint8Array; title: string; document: PDFDocument };
export type PDFTaskResult =
  | PDFDocument
  | Uint8Array
  | { image: string; count: number; page: number };
export type PDFWorkerRequest =
  | { kind: "task"; task: PDFTask }
  | { kind: "printed"; bytes: Uint8Array }
  | { kind: "error"; error: LogError };
export type PDFWorkerResponse =
  | { kind: "result"; result: PDFTaskResult }
  | { kind: "print"; html: string }
  | { kind: "error"; error: LogError };
export type PDFExecution = (task: PDFTask, signal?: AbortSignal) => Promise<PDFTaskResult>;

/** 单文档串行执行，线程按需启动。取消等待线程与打印实际退出后才允许下一任务。 */
export class PDFWorker {
  private worker: Worker | null = null;
  private tail: Promise<unknown> = Promise.resolve(); // 前一任务和打印收尾完成后才派发下一任务
  private readonly lifetime = new AbortController(); // dispose 同时取消活动任务与排队任务

  /** null 入口只供显式同进程执行，正式部署传入计算线程入口。 */
  public constructor(
    private readonly entry: URL | null,
    private readonly print?: PDFHost,
  ) {}

  public readonly run: PDFExecution = async (task, signal) => {
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    combined.throwIfAborted();
    // 入队时固定文档快照；派发时转移独占字节，调用方的原始资产仍可使用。
    const snapshot = structuredClone(task);
    const result = this.tail.then(async () => {
      combined.throwIfAborted();
      if (this.entry === null) {
        // 源码测试显式同进程执行；发行版只通过构建后的独立线程调用。
        const {
          read_pdf_document,
          build_pdf_document,
          build_pdf_page_preview,
          render_pdf_preview,
        } = await import("./pdf-document");
        if (snapshot.kind === "render") return render_pdf_preview(snapshot.bytes, snapshot.page);
        return snapshot.kind === "read"
          ? read_pdf_document(snapshot.bytes)
          : await (snapshot.kind === "preview" ? build_pdf_page_preview : build_pdf_document)({
              page: snapshot.kind === "preview" ? snapshot.page : 1,
              title: snapshot.title,
              document: snapshot.document,
              source_bytes: snapshot.bytes,
              signal: combined,
              print: (html) => this.print_html(html, combined),
            });
      }
      return await this.execute(snapshot, combined);
    });
    this.tail = result.catch(() => undefined); // 单次失败已交回调用者，队列仍可继续。
    return await result;
  };

  /** 取消队列并等待实际资源释放，关闭后实例不能重新运行。 */
  public async dispose(): Promise<void> {
    this.lifetime.abort();
    await this.tail;
    await this.worker?.terminate();
    this.worker = null;
  }

  /** 原稿读取无需宿主，只有译稿排版才要求打印能力。 */
  private async print_html(html: string, signal: AbortSignal): Promise<Uint8Array> {
    if (!this.print) throw new Error("PDF print host unavailable.");
    return await this.print({ kind: "print_pdf", html }, signal);
  }

  /** 一次任务独占线程消息与打印回调，失败回收线程后才交还队列。 */
  private async execute(task: PDFTask, signal: AbortSignal): Promise<PDFTaskResult> {
    const worker = (this.worker ??= new Worker(this.entry!));
    const controller = new AbortController();
    const print_signal = AbortSignal.any([signal, controller.signal]);
    let printing: Promise<void> = Promise.resolve();
    let stopping: Promise<number> | undefined;
    let succeeded = false;
    let on_message: (message: PDFWorkerResponse) => void;
    let on_error: (error: Error) => void;
    let on_exit: (code: number) => void;
    let on_abort: () => void;
    try {
      const result = await new Promise<PDFTaskResult>((resolve, reject) => {
        on_message = (message) => {
          if (message.kind === "result") resolve(message.result);
          else if (message.kind === "error")
            reject(new Error(message.error.message, { cause: message.error }));
          else {
            printing = this.print_html(message.html, print_signal).then(
              (bytes) => {
                if (!print_signal.aborted)
                  worker.postMessage({ kind: "printed", bytes } satisfies PDFWorkerRequest);
              },
              (error) => {
                if (!print_signal.aborted)
                  worker.postMessage({
                    kind: "error",
                    error: to_log_error(error),
                  } satisfies PDFWorkerRequest);
              },
            );
          }
        };
        on_error = reject;
        on_exit = (code) => reject(new Error(`PDF worker exited: ${code}`));
        on_abort = () => {
          stopping = worker.terminate();
          reject(signal.reason);
        };
        worker.on("message", on_message);
        worker.on("error", on_error);
        worker.on("exit", on_exit);
        signal.addEventListener("abort", on_abort, { once: true });
        worker.postMessage({ kind: "task", task } satisfies PDFWorkerRequest, [
          task.bytes.buffer as ArrayBuffer,
        ]);
      });
      signal.throwIfAborted();
      succeeded = true;
      return result;
    } finally {
      controller.abort();
      if (!succeeded) {
        this.worker = null;
        await (stopping ?? worker.terminate());
      }
      await printing;
      worker.off("message", on_message!);
      worker.off("error", on_error!);
      worker.off("exit", on_exit!);
      signal.removeEventListener("abort", on_abort!);
    }
  }
}
