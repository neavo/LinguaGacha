import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PDFFormat } from "./pdf-format";
import { create_pdf_fixture, create_pdf_execution } from "./test-support";

it("PDF 导入保存原页身份，文字页和纯图页均不生成 Item", async () => {
  const bytes = create_pdf_fixture();
  const result = await new PDFFormat(create_pdf_execution()).read_from_stream(bytes, "book.pdf");
  expect(result).toEqual({
    kind: "pdf",
    file_type: "PDF",
    document: {
      digest: createHash("sha256").update(bytes).digest("hex"),
      pages: [1, 2, 3].map((page) => ({
        page,
        width: 300,
        height: 300,
        rotation: 0,
        label: null,
        translation: null,
        reviewed: false,
        notes: "",
      })),
    },
  });
});

it("损坏 PDF 拒绝导入", async () => {
  await expect(
    new PDFFormat(create_pdf_execution()).read_from_stream(new Uint8Array([1, 2]), "bad.pdf"),
  ).rejects.toThrow();
});
