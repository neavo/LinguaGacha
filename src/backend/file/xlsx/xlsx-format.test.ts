import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
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
it("WOLF 原稿缺失时拒绝写出", async () => {
  await expect(
    new XLSXFormat().write_to_path(
      [create_item({ src: "x", row: 2, file_type: "WOLFXLSX", file_path: "x.xlsx" })],
      { translated_path: "unused", bilingual_path: "unused" },
      () => null,
    ),
  ).rejects.toMatchObject({ code: "file.not_found" });
});

it.each(["XLSX", "WOLFXLSX"] as const)("%s 未完成保留源译文，完成空值清空", async (type) => {
  using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-xlsx-kv-"));
  const original = await spreadsheet_fixture({
    A1: "code",
    A2: "原文",
    F2: "原文",
    B2: "A",
    B3: "旧值",
    G2: "A",
    G3: "旧值",
    H2: "其它内容",
  });
  const items = [
    create_item({
      src: "源文",
      dst: "B",
      status: "ERROR",
      row: 2,
      file_type: type,
      file_path: "x.xlsx",
    }),
    create_item({
      src: "源文",
      dst: "",
      status: "PROCESSED",
      row: 3,
      file_type: type,
      file_path: "x.xlsx",
    }),
  ];
  await new XLSXFormat().write_to_path(
    items,
    { translated_path: dir.path, bilingual_path: dir.path },
    () => original,
  );
  const values = await spreadsheet_values(fs.readFileSync(path.join(dir.path, "x.xlsx")));
  expect(values[type === "XLSX" ? "B2" : "G2"]).toBe("A");
  expect(values[type === "XLSX" ? "B3" : "G3"]).toBe("");
  expect(values.H2).toBe("其它内容");
  expect(values[type === "XLSX" ? "A2" : "F2"]).toBe("原文");
});
