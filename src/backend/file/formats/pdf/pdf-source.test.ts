import { expect, it } from "vitest";
import type { PDFDocument } from "../../../../shared/pdf";
import { read_pdf_document, pdf_page_fingerprint } from "./pdf-source";

it("页指纹绑定来源和页面事实，邻页修改不影响当前页", () => {
  const document: PDFDocument = {
    digest: "a".repeat(64),
    pages: [1, 2].map((page) => ({
      page,
      width: 300,
      height: 400,
      rotation: 0,
      label: null,
      translation: null,
      reviewed: false,
      notes: "",
    })),
  };
  const copy = read_pdf_document(JSON.parse(JSON.stringify(document)));
  const first = pdf_page_fingerprint("book.pdf", document.digest, document.pages[0]!);
  copy.pages[1]!.notes = "继续第 2 页";
  expect(pdf_page_fingerprint("book.pdf", copy.digest, copy.pages[0]!)).toBe(first);
  expect(pdf_page_fingerprint("other.pdf", copy.digest, copy.pages[0]!)).not.toBe(first);
  expect(pdf_page_fingerprint("book.pdf", "b".repeat(64), copy.pages[0]!)).not.toBe(first);
  copy.pages[0]!.reviewed = true;
  expect(pdf_page_fingerprint("book.pdf", copy.digest, copy.pages[0]!)).not.toBe(first);
  copy.pages[0]!.reviewed = false;
  copy.pages[0]!.translation = { kind: "keep", reason: "无需翻译" };
  const kept = pdf_page_fingerprint("book.pdf", copy.digest, copy.pages[0]!);
  expect(kept).not.toBe(first);
  copy.pages[0]!.translation.reason = "原页只有插画";
  expect(pdf_page_fingerprint("book.pdf", copy.digest, copy.pages[0]!)).not.toBe(kept);
  copy.pages[0]!.translation = { kind: "omit", reason: "无需翻译" };
  expect(pdf_page_fingerprint("book.pdf", copy.digest, copy.pages[0]!)).not.toBe(kept);
  expect(() => read_pdf_document({ ...document, extra: true })).toThrow();
  copy.pages.reverse();
  expect(() => read_pdf_document(copy)).toThrow("source order");
});
