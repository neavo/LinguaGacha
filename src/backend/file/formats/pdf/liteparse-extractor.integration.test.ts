import { describe, expect, it } from "vitest";

import { build_mixed_pdf, build_text_pdf } from "../../../../test/pdf-fixture";
import { extract_pdf_raw_document } from "./liteparse-extractor";

describe("LiteParse PDF extractor", () => {
  it("把真实文本 PDF 收窄为带页面和 block 几何的项目 raw 类型", async () => {
    const document = await extract_pdf_raw_document(build_text_pdf("LiteParse fixture"));
    expect(document.pages.map((page) => page.page_number)).toEqual([1]);
    expect(
      document.pages[0]?.blocks.some((block) => block.text?.includes("LiteParse fixture")),
    ).toBe(true);
  });

  it("混合 PDF 保留有文本页面，并把空页面标为跳过页", async () => {
    const document = await extract_pdf_raw_document(build_mixed_pdf());
    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]?.blocks.some((block) => block.text?.includes("Mixed PDF"))).toBe(true);
  });
});
