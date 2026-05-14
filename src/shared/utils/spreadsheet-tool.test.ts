import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { SpreadsheetTool } from "./spreadsheet-tool";

describe("SpreadsheetTool", () => {
  it("读取空值、文本和数字时统一转成去空白文本", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = null;
    sheet.getCell(1, 2).value = "  hello  ";
    sheet.getCell(1, 3).value = 123;

    expect(SpreadsheetTool.getCellValue(sheet, 1, 1)).toBe("");
    expect(SpreadsheetTool.getCellValue(sheet, 1, 2)).toBe("hello");
    expect(SpreadsheetTool.getCellValue(sheet, 1, 3)).toBe("123");
  });

  it("写入空值并转义等号开头的文本", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    SpreadsheetTool.setCellValue(sheet, 1, 1, null);
    SpreadsheetTool.setCellValue(sheet, 1, 2, "=SUM(A1:A2)");

    expect(sheet.getCell(1, 1).value).toBe("");
    expect(sheet.getCell(1, 2).value).toBe("'=SUM(A1:A2)");
  });

  it("写入普通文本并应用默认字号", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    SpreadsheetTool.setCellValue(sheet, 2, 1, "plain text");

    expect(sheet.getCell(2, 1).value).toBe("plain text");
    expect(sheet.getCell(2, 1).font.size).toBe(9);
  });

  it("写入时应用字号和对齐样式", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    SpreadsheetTool.setCellValue(sheet, 1, 1, "value", 11);

    expect(sheet.getCell(1, 1).font.size).toBe(11);
    expect(sheet.getCell(1, 1).alignment.wrapText).toBe(true);
    expect(sheet.getCell(1, 1).alignment.vertical).toBe("middle");
    expect(sheet.getCell(1, 1).alignment.horizontal).toBe("left");
  });
});
