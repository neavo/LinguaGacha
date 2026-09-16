import { expect, it } from "vitest";
import type { PDFDocument } from "../../../../shared/pdf";
import { read_pdf_document, pdf_document_fingerprint } from "./pdf-source";

it("持久文档严格读取有序原页，指纹随完整译稿变化", () => {
  const document: PDFDocument = {
    source: {
      digest: "a".repeat(64),
      pages: [1, 2].map((number) => ({
        number,
        width: 300,
        height: 400,
        rotation: 0,
        label: null,
      })),
    },
    translation: null,
  };
  const copy = read_pdf_document(JSON.parse(JSON.stringify(document)));
  expect(pdf_document_fingerprint(copy)).toBe(pdf_document_fingerprint(document));
  copy.translation = { sections: [], reviewed_pages: [1], notes: "继续第 2 页" };
  expect(pdf_document_fingerprint(copy)).not.toBe(pdf_document_fingerprint(document));
  expect(() => read_pdf_document({ ...document, extra: true })).toThrow();
  copy.source.pages.reverse();
  expect(() => read_pdf_document(copy)).toThrow("source order");
});
