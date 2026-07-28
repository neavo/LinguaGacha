import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { SpreadsheetTool } from "./spreadsheet-tool";

describe("SpreadsheetTool", () => {
  it("写入空值并转义等号开头的文本", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    SpreadsheetTool.setCellValue(sheet, 1, 1, null);
    SpreadsheetTool.setCellValue(sheet, 1, 2, "=SUM(A1:A2)");

    expect(sheet.getCell(1, 1).value).toBe("");
    expect(sheet.getCell(1, 2).value).toBe("'=SUM(A1:A2)");
  });

  it("写入文本并应用默认或指定样式", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");

    SpreadsheetTool.setCellValue(sheet, 2, 1, "plain text");
    SpreadsheetTool.setCellValue(sheet, 2, 2, "custom text", 11);

    expect(sheet.getCell(2, 1).value).toBe("plain text");
    expect(sheet.getCell(2, 1).font.size).toBe(9);
    expect(sheet.getCell(2, 2).font.size).toBe(11);
    expect(sheet.getCell(2, 2).alignment).toMatchObject({
      wrapText: true,
      vertical: "middle",
      horizontal: "left",
    });
  });

  it("读取 ExcelJS 包装值中的用户可见文本", () => {
    expect(SpreadsheetTool.cellValueToText(null)).toBe("");
    expect(
      SpreadsheetTool.cellValueToText({ text: "文档", hyperlink: "https://example.com" }),
    ).toBe("文档");
    expect(SpreadsheetTool.cellValueToText({ richText: [{ text: "富" }, { text: "文本" }] })).toBe(
      "富文本",
    );
    expect(SpreadsheetTool.cellValueToText({ formula: "1+1", result: 2 })).toBe("2");
  });
});
