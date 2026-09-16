import { expect, it } from "vitest";
import type { PDFDocument, PDFTranslation } from "../../shared/pdf";
import { pdf_document_fingerprint, type PDFUpdateIntent } from "../file/formats/pdf/pdf-source";
import { resolve_pdf_updates } from "./pdf-document-write";

const document: PDFDocument = {
  source: {
    digest: "a".repeat(64),
    pages: [1, 2].map((number) => ({ number, width: 300, height: 300, rotation: 0, label: null })),
  },
  translation: null,
};
const translation: PDFTranslation = {
  sections: [{ page_start: 1, page_end: 1, markdown: "跨页完整译稿" }],
  reviewed_pages: [1, 2],
  notes: "",
};
const intent = (file_path = "book.pdf"): PDFUpdateIntent => ({
  file_path,
  fp: pdf_document_fingerprint(document),
  translation_path: "work/translation.json",
  translation,
  line: 1,
});

it("同批按文档隔离冲突，旧指纹和重复写入保留当前事实", () => {
  const result = resolve_pdf_updates(
    [intent(), { ...intent("stale.pdf"), fp: "x".repeat(16) }],
    [
      { file_path: "book.pdf", document },
      { file_path: "stale.pdf", document },
    ],
  );
  expect(result.changes.map((change) => change.file_path)).toEqual(["book.pdf"]);
  expect(result.rejected).toMatchObject([{ file_path: "stale.pdf", reason: "fp_mismatch" }]);
  expect(
    resolve_pdf_updates([intent(), intent()], [{ file_path: "book.pdf", document }]).changes,
  ).toEqual([]);
  expect(document.translation).toBeNull();
});

it("部分译稿一次保存，更新正文同时保留核对记录和续做说明", () => {
  const records = [{ file_path: "book.pdf", document }];
  const saved = resolve_pdf_updates([intent()], records).changes[0]!.document;
  expect(saved.translation).toEqual(translation);
  const changed = {
    ...translation,
    sections: [{ page_start: 1, page_end: 2, markdown: "更新译稿" }],
  };
  expect(
    resolve_pdf_updates(
      [{ ...intent(), fp: pdf_document_fingerprint(saved), translation: changed }],
      [{ file_path: "book.pdf", document: saved }],
    ).changes[0]?.document.translation,
  ).toEqual(changed);
});
