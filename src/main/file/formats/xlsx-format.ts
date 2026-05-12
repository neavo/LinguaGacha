import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

import { SpreadsheetTool } from "../../../shared/utils/spreadsheet-tool";
import { group_items, type ExportPaths } from "./file-format-shared";
import { Item } from "../../../base/item";

/**
 * 通用双列表格格式，第一列原文、第二列译文。
 */
export class XLSXFormat {
  /**
   * WOLF 专用表头由 WOLFXLSXFormat 处理，普通格式在这里按双列读取。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const workbook = await load_xlsx_workbook(content);
    const sheet = workbook.worksheets[0];
    if (sheet === undefined || is_wolf_xlsx_sheet(sheet)) {
      return [];
    }
    const items: Item[] = [];
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      const src_value = sheet.getCell(row, 1).value;
      if (src_value === null || src_value === undefined) {
        continue;
      }
      const dst_value = sheet.getCell(row, 2).value;
      const src = SpreadsheetTool.cellValueToText(src_value);
      const dst =
        dst_value === null || dst_value === undefined
          ? ""
          : SpreadsheetTool.cellValueToText(dst_value);
      items.push(
        Item.from_json({
          src,
          dst,
          row,
          file_type: "XLSX",
          file_path: rel_path,
          status: src === "" ? "EXCLUDED" : dst !== "" && src !== dst ? "PROCESSED" : "NONE",
        }),
      );
    }
    return items;
  }

  /**
   * 写回时新建简单双列表，不复用原始工作簿中的展示样式。
   */
  public async write_to_path(items: Item[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "XLSX")) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Sheet");
      sheet.getColumn(1).width = 64;
      sheet.getColumn(2).width = 64;
      for (const item of group.sort((left, right) => left.row - right.row)) {
        SpreadsheetTool.setCellValue(sheet, item.row, 1, item.src);
        SpreadsheetTool.setCellValue(sheet, item.row, 2, item.dst);
      }
      const target_path = path.join(paths.translated_path, rel_path);
      fs.mkdirSync(path.dirname(target_path), { recursive: true });
      await workbook.xlsx.writeFile(target_path);
    }
  }
}

/**
 * ExcelJS 的 load 签名比实际可接收类型更窄，这里把二进制载荷固定转成 Buffer。
 */
async function load_xlsx_workbook(content: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx.load as (data: unknown) => Promise<ExcelJS.Workbook>)(Buffer.from(content));
  return workbook;
}

/**
 * 普通 XLSX 解析器必须主动避开 WOLF 表头，让 WOLFXLSXFormat 保留专用列语义。
 */
function is_wolf_xlsx_sheet(sheet: ExcelJS.Worksheet): boolean {
  const expected = new Map([
    [1, "code"],
    [2, "flag"],
    [3, "type"],
    [4, "info"],
  ]);
  for (const [column, label] of expected) {
    if (
      !String(sheet.getCell(1, column).value ?? "")
        .toLowerCase()
        .includes(label)
    ) {
      return false;
    }
  }
  return true;
}
