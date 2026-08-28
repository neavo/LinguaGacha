import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";

vi.mock("@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm?url", () => ({
  default: pathToFileURL(
    path.join(
      process.cwd(),
      "node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm",
    ),
  ).href,
}));

import { build_mixed_pdf, build_text_pdf } from "../../../../test/pdf-fixture";
import { read_pdf_markdown, read_pdf_markdown_result } from "./pdf-markdown-reader";

describe("pdf-inspector PDF WASM integration", () => {
  it("把真实文本 PDF 转为 Markdown", () => {
    expect(read_pdf_markdown(build_text_pdf())).toContain("LinguaGacha PDF fixture");
  });

  it("混合 PDF 保留文本页并报告需 OCR 页，而不阻塞导入", () => {
    const result = read_pdf_markdown_result(build_mixed_pdf());

    expect(result.markdown).toContain("Mixed PDF text page");
    expect(result.skipped_pages).toContain(2);
  });
});
