import { describe, expect, it } from "vitest";

import { normalize_pdf_document } from "./pdf-semantic-normalizer";
import type { PdfRawDocument } from "./pdf-semantic-types";

const page = (page_number: number, blocks: PdfRawDocument["pages"][number]["blocks"]) => ({
  page_number,
  width: 600,
  height: 800,
  blocks,
});

describe("PDF semantic normalizer", () => {
  it("合并跨页续文并修复视觉断词，但保留正常连字符", () => {
    const result = normalize_pdf_document({
      pages: [
        page(1, [
          {
            kind: "paragraph",
            text: "A long-term defen-",
            bbox: { x: 50, y: 300, width: 300, height: 20 },
          },
        ]),
        page(2, [
          {
            kind: "paragraph",
            text: "ding example continues",
            bbox: { x: 50, y: 100, width: 300, height: 20 },
          },
        ]),
      ],
    });
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.text).toBe("A long-term defending example continues");
  });

  it("过滤重复页眉和页码，保留图注并排除图块", () => {
    const header = {
      kind: "paragraph" as const,
      text: "Running Header",
      bbox: { x: 20, y: 10, width: 100, height: 10 },
    };
    const result = normalize_pdf_document({
      pages: [
        page(1, [
          header,
          { kind: "paragraph", text: "Body", bbox: { x: 50, y: 300, width: 300, height: 20 } },
          { kind: "figure", bbox: { x: 100, y: 400, width: 200, height: 100 } },
          {
            kind: "paragraph",
            text: "Figure 1: Caption",
            bbox: { x: 100, y: 510, width: 200, height: 15 },
          },
        ]),
        page(2, [
          header,
          { kind: "paragraph", text: "2", bbox: { x: 300, y: 780, width: 10, height: 10 } },
        ]),
      ],
    });
    expect(result.blocks.filter((block) => !block.excluded).map((block) => block.text)).toEqual([
      "Body",
      "Figure 1: Caption",
    ]);
  });

  it("检测非矩形表格并公开诊断", () => {
    const result = normalize_pdf_document({
      pages: [
        page(1, [
          { kind: "table", header: [{ text: "A" }, { text: "B" }], rows: [[{ text: "1" }]] },
        ]),
      ],
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "table_structure_uncertain",
    );
  });
});
