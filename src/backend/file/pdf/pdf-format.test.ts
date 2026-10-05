import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { read_pdf_document } from "./pdf-document";
import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PDFFormat } from "./pdf-format";
import { create_pdf_fixture, create_pdf_execution } from "./test-support";

it("PDF 导入保存原页身份，文字页和纯图页均不生成 Item", async () => {
  const bytes = create_pdf_fixture();
  const result = await new PDFFormat(create_pdf_execution()).read_from_stream(bytes);
  expect(result).toEqual({
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
  });
});

it("损坏 PDF 拒绝导入", async () => {
  await expect(
    new PDFFormat(create_pdf_execution()).read_from_stream(new Uint8Array([1, 2])),
  ).rejects.toThrow();
});

it("整份省略清理旧产物，回执为空", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-pdf-format-"));
  const bytes = create_pdf_fixture();
  const document = read_pdf_document(bytes);
  for (const page of document.pages) page.translation = { kind: "omit", reason: "省略" };
  const old_path = path.join(directory.path, "empty.pdf");
  fs.writeFileSync(old_path, bytes);
  expect(
    await new PDFFormat(create_pdf_execution()).write_to_path(
      [{ file_path: "empty.pdf", document }],
      {
        paths: { translated_path: directory.path, bilingual_path: directory.path },
        asset_reader: () => Buffer.from(bytes),
      },
    ),
  ).toEqual([]);
  expect(fs.existsSync(old_path)).toBe(false);
});
