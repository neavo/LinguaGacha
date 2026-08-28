import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  process_pdf: vi.fn(),
  read_file: vi.fn(() => Buffer.from([0])),
}));

vi.mock("@firecrawl/pdf-inspector-wasm", () => ({
  initSync: mocks.init,
  processPdf: mocks.process_pdf,
}));
vi.mock("@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm?url", () => ({
  default: "file:///E:/pdf_inspector_wasm_bg.wasm",
}));
vi.mock("../../../../native/native-fs", () => ({
  default_native_fs: { read_file: mocks.read_file },
}));

describe("read_pdf_markdown", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.init.mockReset();
    mocks.process_pdf.mockReset();
    mocks.read_file.mockClear();
  });

  it("初始化一次、去除页标记并返回可用 Markdown", async () => {
    mocks.process_pdf.mockReturnValue({
      pdfType: "Mixed",
      markdown: "<!-- Page 1 -->\n# 第一页\n<!-- Page 2 -->\n",
      pageCount: 2,
      pagesNeedingOcr: [2],
    });
    const { read_pdf_markdown_result } = await import("./pdf-markdown-reader");

    expect(read_pdf_markdown_result(new Uint8Array([1]))).toEqual({
      markdown: "# 第一页\n",
      skipped_pages: [2],
    });
    expect(read_pdf_markdown_result(new Uint8Array([2]))).toEqual({
      markdown: "# 第一页\n",
      skipped_pages: [2],
    });

    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.process_pdf).toHaveBeenCalledWith(new Uint8Array([2]), {
      includePageMarkers: true,
      profile: "fidelity",
    });
  });

  it("没有可提取文本时返回普通解析失败并保留原因", async () => {
    mocks.process_pdf.mockReturnValue({
      pdfType: "Scanned",
      markdown: "",
      pageCount: 2,
      pagesNeedingOcr: [2, 1, 2],
    });
    const { read_pdf_markdown } = await import("./pdf-markdown-reader");

    expect(() => read_pdf_markdown(new Uint8Array())).toThrow(
      expect.objectContaining({
        code: "file.parse_failed",
        diagnostic_context: {
          format: "PDF",
          reason: "no_extractable_text",
          pdf_type: "Scanned",
          pages: [1, 2],
          pageCount: 2,
        },
      }),
    );
  });

  it("加密 trailer 与其他处理错误都映射为 parse_failed", async () => {
    mocks.process_pdf.mockImplementation(() => {
      throw new Error("process PDF failed");
    });
    const { read_pdf_markdown } = await import("./pdf-markdown-reader");

    expect(() =>
      read_pdf_markdown(new TextEncoder().encode("%PDF-1.7\ntrailer << /Encrypt 9 0 R >>")),
    ).toThrow(
      expect.objectContaining({
        code: "file.parse_failed",
        diagnostic_context: { format: "PDF", reason: "encrypted" },
      }),
    );
    expect(() => read_pdf_markdown(new Uint8Array([1, 2, 3]))).toThrow(
      expect.objectContaining({ code: "file.parse_failed" }),
    );
  });

  it("WASM 初始化失败映射为 IO 失败并保留 cause", async () => {
    const failure = new Error("wasm unavailable");
    mocks.init.mockImplementation(() => {
      throw failure;
    });
    const { read_pdf_markdown } = await import("./pdf-markdown-reader");

    try {
      read_pdf_markdown(new Uint8Array());
      throw new Error("预期抛出错误");
    } catch (error) {
      expect(error).toMatchObject({ code: "file.io_failed", cause: failure });
    }
  });
});
