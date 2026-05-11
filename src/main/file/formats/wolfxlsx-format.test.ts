import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalize_item } from "../../../base/item";
import { WOLFXLSXFormat } from "./wolfxlsx-format";

// 每个用例独占工作簿输出目录，避免 WOLF 写回测试共享文件状态。
let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-wolfxlsx-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("WOLFXLSXFormat", () => {
  it("按 WOLF 表头、固定列和填充色读取条目", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    ["code", "flag", "type", "info"].forEach((label, index) => {
      sheet.getCell(1, index + 1).value = label;
    });
    sheet.getCell(2, 6).value = { richText: [{ text: "原" }, { text: "文" }] };
    sheet.getCell(2, 6).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { indexed: 9 } as never,
    };
    sheet.getCell(2, 7).value = { formula: "F2", result: "译文" };
    const buffer = await workbook.xlsx.writeBuffer();

    const items = await new WOLFXLSXFormat().read_from_stream(new Uint8Array(buffer), "wolf.xlsx");

    expect(items).toEqual([
      expect.objectContaining({
        src: "原文",
        dst: "译文",
        row: 2,
        file_type: "WOLFXLSX",
        text_type: "WOLF",
        status: "PROCESSED",
      }),
    ]);
  });

  it("普通双列表不会被 WOLF 格式抢先解析", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet");
    sheet.getCell(1, 1).value = "原文";
    sheet.getCell(1, 2).value = "译文";
    const buffer = await workbook.xlsx.writeBuffer();

    await expect(
      new WOLFXLSXFormat().read_from_stream(new Uint8Array(buffer), "demo.xlsx"),
    ).resolves.toEqual([]);
  });

  it("写回时复用原始工作簿并更新 WOLF 固定列", async () => {
    const original = new ExcelJS.Workbook();
    const sheet = original.addWorksheet("Sheet");
    ["code", "flag", "type", "info"].forEach((label, index) => {
      sheet.getCell(1, index + 1).value = label;
    });
    const buffer = Buffer.from(await original.xlsx.writeBuffer());
    const format = new WOLFXLSXFormat();

    await format.write_to_path(
      [
        normalize_item({
          src: "原文",
          dst: "译文",
          row: 2,
          file_type: "WOLFXLSX",
          file_path: "wolf.xlsx",
        }),
        normalize_item({
          src: "=SUM(F1:F2)",
          dst: "=SUM(G1:G2)",
          row: 3,
          file_type: "WOLFXLSX",
          file_path: "wolf.xlsx",
        }),
      ],
      {
        translated_path: temp_dir,
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
      () => buffer,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(temp_dir, "wolf.xlsx"));

    expect(workbook.worksheets[0]?.getCell(2, 6).value).toBe("原文");
    expect(workbook.worksheets[0]?.getCell(2, 7).value).toBe("译文");
    expect(workbook.worksheets[0]?.getCell(3, 6).value).toBe("'=SUM(F1:F2)");
    expect(workbook.worksheets[0]?.getCell(3, 6).alignment.horizontal).toBe("left");
  });
});
