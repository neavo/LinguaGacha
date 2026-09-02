import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { Item } from "../../../domain/item";
import { XLSXFormat } from "./xlsx-format";

describe("XLSXFormat", () => {
  it("读取普通双列表并按源文译文关系设置状态", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = "src1";
    sheet.getCell(1, 2).value = "dst1";
    sheet.getCell(2, 1).value = "same";
    sheet.getCell(2, 2).value = "same";
    sheet.getCell(3, 1).value = 123;
    const buffer = await workbook.xlsx.writeBuffer();

    const items = await new XLSXFormat().read_from_stream(new Uint8Array(buffer), "demo.xlsx");

    expect(items.map((item) => item.status)).toEqual(["PROCESSED", "NONE", "NONE"]);
    expect(items[2]).toEqual(expect.objectContaining({ src: "123", dst: "" }));
  });

  it("跳过缺少源文的行并保留后续行号", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = "src1";
    sheet.getCell(1, 2).value = "dst1";
    sheet.getCell(3, 1).value = "src3";
    const buffer = await workbook.xlsx.writeBuffer();

    const items = await new XLSXFormat().read_from_stream(new Uint8Array(buffer), "sheet.xlsx");

    expect(items.map((item) => [item.src, item.row])).toEqual([
      ["src1", 1],
      ["src3", 3],
    ]);
  });

  it("空源文行标记为规则跳过", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = "";
    sheet.getCell(1, 2).value = "x";
    const buffer = await workbook.xlsx.writeBuffer();

    const items = await new XLSXFormat().read_from_stream(new Uint8Array(buffer), "sheet.xlsx");

    expect(items[0]?.status).toBe("RULE_SKIPPED");
  });

  it("支持富文本和公式结果单元格转成纯文本", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = { richText: [{ text: "原" }, { text: "文" }] };
    sheet.getCell(1, 2).value = { formula: "A1", result: "译文" };
    const buffer = await workbook.xlsx.writeBuffer();

    const items = await new XLSXFormat().read_from_stream(new Uint8Array(buffer), "demo.xlsx");

    expect(items[0]).toEqual(
      expect.objectContaining({
        src: "原文",
        dst: "译文",
        row: 1,
        file_type: "XLSX",
        status: "PROCESSED",
      }),
    );
  });

  it("遇到 WOLF 表头时让专用格式处理器接管", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    ["code", "flag", "type", "info"].forEach((label, index) => {
      sheet.getCell(1, index + 1).value = label;
    });
    sheet.getCell(2, 1).value = "普通列原文";
    const buffer = await workbook.xlsx.writeBuffer();

    await expect(
      new XLSXFormat().read_from_stream(new Uint8Array(buffer), "wolf.xlsx"),
    ).resolves.toEqual([]);
  });

  it("写回普通双列表工作簿并按行号排序", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-xlsx-format-"));
    const format = new XLSXFormat();
    await format.write_to_path(
      [
        Item.from_json({
          src: "row2-src",
          dst: "row2-dst",
          row: 2,
          file_type: "XLSX",
          file_path: "excel/a.xlsx",
        }),
        Item.from_json({
          src: "row1-src",
          dst: "row1-dst",
          row: 1,
          file_type: "XLSX",
          file_path: "excel/a.xlsx",
        }),
      ],
      {
        translated_path: temp_dir.path,
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(temp_dir.path, "excel", "a.xlsx"));

    expect(workbook.worksheets[0]?.getCell(1, 1).value).toBe("row1-src");
    expect(workbook.worksheets[0]?.getCell(1, 2).value).toBe("row1-dst");
    expect(workbook.worksheets[0]?.getCell(2, 1).value).toBe("row2-src");
    expect(workbook.worksheets[0]?.getCell(2, 2).value).toBe("row2-dst");
  });

  it("写回时保留空译文为空单元格", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-xlsx-format-"));
    const format = new XLSXFormat();

    await format.write_to_path(
      [
        Item.from_json({
          src: "row1-src",
          dst: "",
          row: 1,
          file_type: "XLSX",
          file_path: "excel/empty.xlsx",
        }),
      ],
      {
        translated_path: temp_dir.path,
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(temp_dir.path, "excel", "empty.xlsx"));

    expect(workbook.worksheets[0]?.getCell(1, 2).value).toBe("");
  });

  it("写回公式样文本时按文本保存", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-xlsx-format-"));
    const format = new XLSXFormat();
    await format.write_to_path(
      [
        Item.from_json({
          src: "=SUM(A1:A2)",
          dst: "=SUM(B1:B2)",
          row: 1,
          file_type: "XLSX",
          file_path: "formula.xlsx",
        }),
      ],
      {
        translated_path: temp_dir.path,
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(temp_dir.path, "formula.xlsx"));

    expect(workbook.worksheets[0]?.getCell(1, 1).value).toBe("'=SUM(A1:A2)");
  });
});
