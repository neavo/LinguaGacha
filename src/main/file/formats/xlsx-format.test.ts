import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../base/item";
import { XLSXFormat } from "./xlsx-format";

let temp_dir = ""; // 每个用例独占工作簿输出目录，避免 ExcelJS 文件写回互相影响

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-xlsx-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("XLSXFormat", () => {
  it("按普通双列表读取原文和译文", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = { richText: [{ text: "原" }, { text: "文" }] };
    sheet.getCell(1, 2).value = { formula: "A1", result: "译文" };
    const buffer = await workbook.xlsx.writeBuffer();

    const items = await new XLSXFormat().read_from_stream(new Uint8Array(buffer), "demo.xlsx");

    expect(items).toEqual([
      expect.objectContaining({
        src: "原文",
        dst: "译文",
        row: 1,
        file_type: "XLSX",
        status: "PROCESSED",
      }),
    ]);
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

  it("写回普通双列表工作簿", async () => {
    const format = new XLSXFormat();
    await format.write_to_path(
      [
        Item.from_json({
          src: "原文",
          dst: "译文",
          row: 1,
          file_type: "XLSX",
          file_path: "demo.xlsx",
        }),
        Item.from_json({
          src: "=SUM(A1:A2)",
          dst: "=SUM(B1:B2)",
          row: 2,
          file_type: "XLSX",
          file_path: "demo.xlsx",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(temp_dir, "demo.xlsx"));

    expect(workbook.worksheets[0]?.getCell(1, 1).value).toBe("原文");
    expect(workbook.worksheets[0]?.getCell(1, 2).value).toBe("译文");
    expect(workbook.worksheets[0]?.getCell(2, 1).value).toBe("'=SUM(A1:A2)");
    expect(workbook.worksheets[0]?.getCell(2, 1).font.size).toBe(9);
  });
});
