import { expect, it, vi } from "vitest";
import { ProofreadingPagePreview } from "./proofreading-page-preview";
import { ProjectSessionState } from "../project/project-session-state";
import { PDFWorker } from "../file/formats/pdf/pdf-worker";
import { create_pdf_fixture } from "../file/formats/pdf/test-support";
import { read_pdf_document } from "../file/formats/pdf/pdf-document";

it("预览按需打印并复用分页，核对更新不重印，无输出页不调用打印", async () => {
  const source = create_pdf_fixture();
  const document = read_pdf_document(source);
  const session = new ProjectSessionState();
  await session.mark_loaded("test.lg");
  const print = vi.fn(async () => create_pdf_fixture(["First", "Second"]));
  const worker = new PDFWorker(null, print);
  const service = new ProofreadingPagePreview(
    { read_pdf_document: () => document, read_asset_content: () => Buffer.from(source) },
    session,
    worker.run,
  );
  const request = {
    request_id: "detail",
    project_path: "test.lg",
    file_path: "book.pdf",
    page: 1,
    action: "translation",
  };
  try {
    expect(await service.query(request)).toEqual({});
    document.pages[0]!.translation = { kind: "keep", reason: "封面" };
    expect(await service.query(request)).toEqual({});
    document.pages[0]!.translation = { kind: "omit", reason: "空页" };
    expect(await service.query(request)).toEqual({});
    document.pages[0]!.translation = { kind: "translate", markdown: "" };
    expect(await service.query(request)).toEqual({});
    expect(print).not.toHaveBeenCalled();
    document.pages[0]!.translation = { kind: "translate", markdown: "正文" };
    expect(await service.query(request)).toMatchObject({
      count: 2,
      page: 1,
      image: expect.stringMatching(/^data:image\/png;base64,/),
    });
    document.pages[0]!.reviewed = true;
    expect(await service.query({ ...request, output_page: 2 })).toMatchObject({
      count: 2,
      page: 2,
    });
    expect(print).toHaveBeenCalledTimes(1);
    await service.query({ ...request, action: "source" });
    expect(print).toHaveBeenCalledTimes(1);
    await service.query({ request_id: "detail", action: "close" });
    await service.query(request);
    expect(print).toHaveBeenCalledTimes(2);
    await session.mark_loaded("other.lg");
    await expect(service.query(request)).rejects.toThrow();
  } finally {
    service.dispose();
    await worker.dispose();
  }
});

it("工程切换取消正在打印的旧预览，失败打印可以重试", async () => {
  const source = create_pdf_fixture();
  const document = read_pdf_document(source);
  document.pages[0]!.translation = { kind: "translate", markdown: "正文" };
  const session = new ProjectSessionState();
  await session.mark_loaded("test.lg");
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const print = vi.fn(async (_request, signal: AbortSignal | undefined): Promise<Uint8Array> => {
    entered();
    return new Promise((_resolve, reject) =>
      signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
    );
  });
  const worker = new PDFWorker(null, print);
  const service = new ProofreadingPagePreview(
    { read_pdf_document: () => document, read_asset_content: () => Buffer.from(source) },
    session,
    worker.run,
  );
  const request = {
    request_id: "detail",
    project_path: "test.lg",
    file_path: "book.pdf",
    page: 1,
    action: "translation",
  };
  try {
    const result = service.query(request);
    const rejected = expect(result).rejects.toThrow();
    await started;
    await session.clear();
    await rejected;
    await session.mark_loaded("test.lg");
    print.mockRejectedValueOnce(new Error("print failed"));
    await expect(service.query(request)).rejects.toThrow("print failed");
    print.mockResolvedValueOnce(create_pdf_fixture(["Recovered"]));
    expect(await service.query(request)).toMatchObject({ count: 1 });
  } finally {
    service.dispose();
    await worker.dispose();
  }
});
