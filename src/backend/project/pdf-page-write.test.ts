import { expect, it } from "vitest";
import type { PDFDocument } from "../../shared/pdf";
import { pdf_page_fingerprint, type PDFUpdateIntent } from "../file/formats/pdf/pdf-source";
import { resolve_pdf_updates } from "./pdf-page-write";

const document: PDFDocument = {
  digest: "a".repeat(64),
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
};
/** 每次从固定页面基线生成独立意图，便于改变单个提交条件。 */
const intent = (page = 1): PDFUpdateIntent => ({
  file_path: "book.pdf",
  page,
  fp: pdf_page_fingerprint("book.pdf", document.digest, document.pages[page - 1]!),
  translation: { kind: "translate", markdown: "完整译稿" },
  reviewed: true,
  notes: "待核对图注",
  line: page,
});
const records = [{ file_path: "book.pdf", document }];

it("同一文档按页隔离旧指纹和重复写入，拒绝回执定位原页", () => {
  const result = resolve_pdf_updates(
    [intent(), { ...intent(2), fp: "x".repeat(intent(2).fp.length) }, intent(3), intent(3)],
    records,
  );
  expect(result.changes.map((change) => change.page.page)).toEqual([1]);
  expect(result.rejected).toMatchObject([
    { file_path: "book.pdf", page: 2, reason: "fp_mismatch" },
    { file_path: "book.pdf", page: 3, reason: "merge_conflict" },
    { file_path: "book.pdf", page: 3, reason: "merge_conflict" },
  ]);
  expect(document.pages.every((page) => page.translation === null)).toBe(true);
});

it("页面正文、核对和说明一并替换，恢复原文与无变化提交使用同一入口", () => {
  const saved = resolve_pdf_updates([intent()], records).changes[0]!.page;
  expect(saved).toMatchObject({
    translation: intent().translation,
    reviewed: true,
    notes: "待核对图注",
  });
  const current = { ...document, pages: [saved, ...document.pages.slice(1)] };
  const fp = pdf_page_fingerprint("book.pdf", current.digest, saved);
  expect(
    resolve_pdf_updates([{ ...intent(), fp }], [{ file_path: "book.pdf", document: current }])
      .changes,
  ).toEqual([]);
  const restored = resolve_pdf_updates(
    [{ ...intent(), fp, translation: null, reviewed: false, notes: "" }],
    [{ file_path: "book.pdf", document: current }],
  );
  expect(restored.changes[0]!.page).toEqual(document.pages[0]);
});

it("页面保存允许空译稿与全部省略，非法正文和来源变化只拒绝相应页", () => {
  const result = resolve_pdf_updates(
    [
      { ...intent(), translation: { kind: "translate", markdown: "" } },
      { ...intent(2), translation: { kind: "omit", reason: "装饰页" } },
      {
        ...intent(3),
        translation: { kind: "translate", markdown: "![bad](https://example.com/image.png)" },
      },
    ],
    records,
  );
  expect(result.changes.map((change) => change.page.page)).toEqual([1, 2]);
  expect(result.rejected).toMatchObject([{ page: 3, reason: "invalid_change" }]);
  expect(
    resolve_pdf_updates(
      document.pages.map((page) => ({
        ...intent(page.page),
        translation: { kind: "omit", reason: "按要求省略" },
      })),
      records,
    ).changes,
  ).toHaveLength(3);
  expect(
    resolve_pdf_updates(
      [intent()],
      [{ file_path: "book.pdf", document: { ...document, digest: "b".repeat(64) } }],
    ).rejected,
  ).toMatchObject([{ page: 1, reason: "fp_mismatch" }]);
  expect(resolve_pdf_updates([{ ...intent(), page: 4 }], records).rejected).toMatchObject([
    { page: 4, reason: "target_missing" },
  ]);
});
