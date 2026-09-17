import { expect, it } from "vitest";
import type { PDFDocument } from "../../../../shared/pdf";
import { read_pdf_document } from "./pdf-source";

it("文档读取校验字段与来源页序", () => {
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
  expect(() => read_pdf_document({ ...document, extra: true })).toThrow();
  copy.pages.reverse();
  expect(() => read_pdf_document(copy)).toThrow("source order");
});
