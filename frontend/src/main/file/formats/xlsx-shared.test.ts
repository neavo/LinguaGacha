import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { cell_to_text, is_wolf_sheet, load_workbook } from "./xlsx-shared";

describe("xlsx-shared", () => {
  it("把普通文本、富文本和公式结果转换为文本", () => {
    expect(cell_to_text(null)).toBe("");
    expect(cell_to_text("原文")).toBe("原文");
    expect(cell_to_text({ richText: [{ text: "甲" }, { text: "乙" }] })).toBe("甲乙");
    expect(cell_to_text({ formula: "A1", result: "结果" })).toBe("结果");
  });

  it("通过前四列表头识别 WOLF 工作表", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    ["code", "flag", "type", "info"].forEach((label, index) => {
      sheet.getCell(1, index + 1).value = label;
    });

    expect(is_wolf_sheet(sheet)).toBe(true);
    sheet.getCell(1, 4).value = "other";
    expect(is_wolf_sheet(sheet)).toBe(false);
  });

  it("从二进制内容加载工作簿", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet").getCell(1, 1).value = "原文";
    const buffer = await workbook.xlsx.writeBuffer();

    const loaded = await load_workbook(new Uint8Array(buffer));

    expect(loaded.worksheets[0]?.getCell(1, 1).value).toBe("原文");
  });
});
