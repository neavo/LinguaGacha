import type { PDFExecution } from "../file/pdf/pdf-worker";
import { expect, it, vi } from "vitest";
import { ProofreadingPagePreview } from "./proofreading-page-preview";
import { ProjectSessionState } from "../project/project-session-state";
import { PDFWorker } from "../file/pdf/pdf-worker";
import { create_pdf_fixture } from "../file/pdf/test-support";
import { read_pdf_document } from "../file/pdf/pdf-document";

it("原稿和译稿并行共享资产与打印，失败资产可重试", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  document.pages[0]!.translation = { kind: "translate", markdown: "正文" };
  const session = new ProjectSessionState();
  await session.mark_loaded("test.lg");
  const release = Promise.withResolvers<void>();
  const asset = vi.fn(async () => {
    await release.promise;
    return Buffer.from([1]);
  });
  const execute = vi.fn(async (request: Parameters<PDFExecution>[0]) =>
    request.kind === "preview" ? new Uint8Array([2]) : { image: "image", count: 1, page: 1 },
  );
  const service = new ProofreadingPagePreview(
    { read_pdf_document: async () => document, read_asset_content: asset },
    session,
    execute,
  );
  const request = { request_id: "same", project_path: "test.lg", file_path: "book.pdf", page: 1 };
  try {
    const results = Promise.all(
      ["source", "translation", "translation"].map((action) =>
        service.query({ ...request, action }),
      ),
    );
    release.resolve();
    expect(await results).toEqual(
      Array.from({ length: 3 }, () => ({ image: "image", count: 1, page: 1 })),
    );
    expect(asset).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.filter(([request]) => request.kind === "preview")).toHaveLength(1);
    await service.query({ request_id: "same", action: "close" });
    asset.mockRejectedValueOnce(new Error("asset failed"));
    await expect(service.query({ ...request, action: "source" })).rejects.toThrow("asset failed");
    await expect(service.query({ ...request, action: "source" })).resolves.toHaveProperty(
      "image",
      "image",
    );
  } finally {
    release.resolve();
    service.dispose();
  }
});

it("旧详情加载迟到和迟到关闭均不影响新详情", async () => {
  const document = read_pdf_document(create_pdf_fixture());
  const session = new ProjectSessionState();
  await session.mark_loaded("test.lg");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const asset = vi
    .fn(async () => Buffer.from([1]))
    .mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return Buffer.from([1]);
    });
  const service = new ProofreadingPagePreview(
    { read_pdf_document: async () => document, read_asset_content: asset },
    session,
    async () => ({ image: "new-image", count: 1, page: 1 }),
  );
  const request = { project_path: "test.lg", file_path: "book.pdf", page: 1, action: "source" };
  try {
    const old = service.query({ ...request, request_id: "old" });
    const rejected = expect(old).rejects.toMatchObject({ code: "runtime.cancelled" });
    await entered.promise;
    await expect(service.query({ ...request, request_id: "new" })).resolves.toHaveProperty(
      "image",
      "new-image",
    );
    await service.query({ request_id: "old", action: "close" });
    release.resolve();
    await rejected;
    await expect(service.query({ ...request, request_id: "new" })).resolves.toHaveProperty(
      "image",
      "new-image",
    );
    expect(asset).toHaveBeenCalledTimes(2);
  } finally {
    release.resolve();
    service.dispose();
  }
});

it.each(["document", "asset", "final"] as const)(
  "%s 读取期间关闭详情或切换工程，迟到结果不能恢复预览",
  async (phase) => {
    for (const invalidate of ["close", "project"] as const) {
      const document = read_pdf_document(create_pdf_fixture());
      const session = new ProjectSessionState();
      await session.mark_loaded("test.lg");
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let reads = 0;
      const wait = async () => {
        entered.resolve();
        await release.promise;
      };
      const execute = vi.fn(async () => ({ image: "old-image", count: 1, page: 1 }));
      const asset = vi.fn(async () => {
        if (phase === "asset") await wait();
        return Buffer.from([1]);
      });
      const service = new ProofreadingPagePreview(
        {
          read_pdf_document: async () => {
            reads++;
            if ((phase === "document" && reads === 1) || (phase === "final" && reads === 2))
              await wait();
            return document;
          },
          read_asset_content: asset,
        },
        session,
        execute,
      );
      try {
        const result = service.query({
          request_id: "old",
          project_path: "test.lg",
          file_path: "book.pdf",
          page: 1,
          action: "source",
        });
        const rejected = expect(result).rejects.toMatchObject({ code: "runtime.cancelled" });
        await entered.promise;
        if (invalidate === "close") await service.query({ request_id: "old", action: "close" });
        else await session.mark_loaded("other.lg");
        release.resolve();
        await rejected;
        if (phase !== "final") expect(execute).not.toHaveBeenCalled();
        if (phase === "document") expect(asset).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        service.dispose();
      }
    }
  },
);

it("预览按需打印并复用分页，核对更新不重印，无输出页不调用打印", async () => {
  const source = create_pdf_fixture();
  const document = read_pdf_document(source);
  const session = new ProjectSessionState();
  await session.mark_loaded("test.lg");
  const print = vi.fn(async () => create_pdf_fixture(["First", "Second"]));
  const worker = new PDFWorker(null, print);
  const service = new ProofreadingPagePreview(
    {
      read_pdf_document: async () => document,
      read_asset_content: async () => Buffer.from(source),
    },
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
    {
      read_pdf_document: async () => document,
      read_asset_content: async () => Buffer.from(source),
    },
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
    const rejected = expect(result).rejects.toMatchObject({ code: "runtime.cancelled" });
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
