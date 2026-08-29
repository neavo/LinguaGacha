import { describe, expect, it, vi } from "vitest";

const extract_pdf_raw_document = vi.hoisted(() => vi.fn());
const normalize_pdf_document = vi.hoisted(() => vi.fn());
const write_pdf_semantic_markdown = vi.hoisted(() => vi.fn());

vi.mock("./liteparse-extractor", () => ({ extract_pdf_raw_document }));
vi.mock("./pdf-semantic-normalizer", () => ({ normalize_pdf_document }));
vi.mock("./pdf-semantic-markdown-writer", () => ({ write_pdf_semantic_markdown }));

import { read_pdf_document } from "./pdf-document-reader";

describe("PDF document reader", () => {
  it("按固定顺序串联抽取、归一和 Markdown 投影", async () => {
    const raw = { pages: [] };
    const semantic = {
      blocks: [{ order: 0, kind: "paragraph", text: "正文" }],
      diagnostics: [],
    };
    extract_pdf_raw_document.mockResolvedValueOnce(raw);
    normalize_pdf_document.mockReturnValueOnce(semantic);
    write_pdf_semantic_markdown.mockReturnValueOnce("正文\n");

    await expect(read_pdf_document(new Uint8Array([1]))).resolves.toEqual({
      markdown: "正文\n",
    });
    expect(extract_pdf_raw_document).toHaveBeenCalledWith(new Uint8Array([1]));
    expect(normalize_pdf_document).toHaveBeenCalledWith(raw);
    expect(write_pdf_semantic_markdown).toHaveBeenCalledWith(semantic);
  });

  it("结构错误或空 Markdown 时返回统一解析失败", async () => {
    extract_pdf_raw_document.mockResolvedValue({ pages: [] });
    normalize_pdf_document.mockReturnValue({
      blocks: [],
      diagnostics: [{ code: "empty_block", severity: "error" }],
    });
    write_pdf_semantic_markdown.mockReturnValue("");

    await expect(read_pdf_document(new Uint8Array())).rejects.toMatchObject({
      code: "file.parse_failed",
      diagnostic_context: { format: "PDF", reason: "invalid_structure" },
    });
  });
});
