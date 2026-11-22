/** 只跨宿主传递应用生成的 HTML，最终落盘归后端。 */
export type PDFHostOperation = { kind: "print_pdf"; html: string };
export type PDFHost = (operation: PDFHostOperation, signal?: AbortSignal) => Promise<Uint8Array>;
