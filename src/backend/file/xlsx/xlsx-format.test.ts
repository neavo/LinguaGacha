import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { Item } from "../../../domain/item";
import { spreadsheet_fixture, spreadsheet_values } from "../../../test/spreadsheet-fixture";
import { XLSXFormat } from "./xlsx-format";

it("双列读取保留稀疏行号、空文本、数值、富文本及公式缓存", async () => {
  const bytes = await spreadsheet_fixture({
    A1: "src",
    B1: "dst",
    A3: "same",
    B3: "same",
    A4: 123,
    A7: new Date("2026-01-02T00:00:00Z"),
    A5: "",
    B5: "x",
    A6: { rich: ["原", "文"] },
    B6: { formula: "A6", result: "译文" },
  });
  const items = await new XLSXFormat().read_from_stream(bytes, "sheet.xlsx");
  expect(items.map((item) => [item.row, item.src, item.dst, item.status])).toEqual([
    [1, "src", "dst", "PROCESSED"],
    [3, "same", "same", "NONE"],
    [4, "123", "", "NONE"],
    [5, "", "x", "RULE_SKIPPED"],
    [6, "原文", "译文", "PROCESSED"],
    [7, String(new Date("2026-01-02T00:00:00Z")), "", "NONE"],
  ]);
});
it("WOLF 只按固定列、源单元格存在性和索引填充色选取", async () => {
  const bytes = await spreadsheet_fixture({
    A1: "code",
    B1: "flag",
    C1: "type",
    D1: "info",
    F2: { text: "原文1", fill: 9 },
    F3: { rich: ["原", "文2"], fill: 9 },
    G3: { formula: "F3", result: "已译" },
    F4: { text: "排除", fill: 44 },
    F5: "无填充",
    G6: "缺原文",
  });
  const items = await new XLSXFormat().read_from_stream(bytes, "wolf.xlsx");
  expect(items.map((item) => [item.row, item.src, item.dst, item.status, item.file_type])).toEqual([
    [2, "原文1", "", "NONE", "WOLFXLSX"],
    [3, "原文2", "已译", "PROCESSED", "WOLFXLSX"],
    [4, "排除", "", "RULE_SKIPPED", "WOLFXLSX"],
    [5, "无填充", "", "RULE_SKIPPED", "WOLFXLSX"],
  ]);
});
it.each(["XLSX", "WOLFXLSX"] as const)("%s 写回正确列，保留空译文和公式样文本", async (type) => {
  using root = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-xlsx-"));
  const original = await spreadsheet_fixture({
    A1: "code",
    B1: "flag",
    C1: "type",
    D1: "info",
    F2: { text: "旧原文", fill: 9 },
    H2: "保留",
  });
  const format = new XLSXFormat();
  await format.write_to_path(
    [
      Item.from_json({
        src: "=SUM(A1:A2)",
        dst: "",
        row: 2,
        file_type: type,
        file_path: "nested/file.xlsx",
      }),
    ],
    { translated_path: root.path, bilingual_path: root.path },
    () => original,
  );
  const bytes = fs.readFileSync(path.join(root.path, "nested/file.xlsx"));
  const cells = await spreadsheet_values(bytes);
  expect(cells[type === "XLSX" ? "A2" : "F2"]).toBe("'=SUM(A1:A2)");
  expect(cells[type === "XLSX" ? "B2" : "G2"]).toBe("");
  if (type === "WOLFXLSX") {
    expect(cells.H2).toBe("保留");
    expect((await format.read_from_stream(bytes, "wolf.xlsx"))[0]?.status).toBe("NONE");
  }
});
it("WOLF 原稿缺失时拒绝写出", async () => {
  await expect(
    new XLSXFormat().write_to_path(
      [Item.from_json({ src: "x", row: 2, file_type: "WOLFXLSX", file_path: "x.xlsx" })],
      { translated_path: "unused", bilingual_path: "unused" },
    ),
  ).rejects.toMatchObject({ code: "file.not_found" });
});
