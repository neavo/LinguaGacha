import path from "node:path";

import ExcelJS from "exceljs";

import { SpreadsheetTool } from "../../../shared/utils/spreadsheet-tool";
import { group_items, type ExportPaths } from "./file-format-shared";
import { Item } from "../../../domain/item";
import { is_wolf_xlsx_sheet, load_xlsx_workbook, write_xlsx_workbook } from "./xlsx-format";

const COL_SRC_TEXT = 6; // WOLF XLSX 的源文和译文列号来自旧固定实现
const COL_DST_TEXT = 7;
const FILL_COLOR_WHITELIST = new Set([9]); // 只有白色填充的源文列参与翻译，其它颜色由 WOLF 格式规则跳过

/**
 * WOLF RPG 导出的专用 XLSX 格式，列结构和填充色过滤对齐旧实现
 */
export class WOLFXLSXFormat {
  /**
   * 只处理识别为 WOLF 表头的工作表，普通 XLSX 留给 XLSXFormat
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const workbook = await load_xlsx_workbook(content);
    const sheet = workbook.worksheets[0];
    if (sheet === undefined || !is_wolf_xlsx_sheet(sheet)) {
      return [];
    }
    const items: Item[] = [];
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const src_value = sheet.getCell(row, COL_SRC_TEXT).value;
      if (src_value === null || src_value === undefined) {
        continue;
      }
      const dst_value = sheet.getCell(row, COL_DST_TEXT).value;
      const src = SpreadsheetTool.cellValueToText(src_value);
      const dst =
        dst_value === null || dst_value === undefined
          ? ""
          : SpreadsheetTool.cellValueToText(dst_value);
      const fill_index = this.get_fg_color_index(sheet, row, COL_SRC_TEXT);
      items.push(
        Item.from_json({
          src,
          dst,
          row,
          file_type: "WOLFXLSX",
          file_path: rel_path,
          text_type: "WOLF",
          status:
            src === "" || !FILL_COLOR_WHITELIST.has(fill_index)
              ? "RULE_SKIPPED"
              : dst !== "" && src !== dst
                ? "PROCESSED"
                : "NONE",
        }),
      );
    }
    return items;
  }

  /**
   * 写回时优先复用原始工作簿，避免破坏 WOLF 表格的其它列
   */
  public async write_to_path(
    items: Item[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "WOLFXLSX")) {
      const original = asset_reader(rel_path);
      const workbook =
        original !== null ? await load_xlsx_workbook(original) : new ExcelJS.Workbook();
      const sheet = workbook.worksheets[0] ?? workbook.addWorksheet("Sheet");
      if (original === null) {
        sheet.getColumn(1).width = 64;
        sheet.getColumn(2).width = 64;
      }
      for (const item of group.sort((left, right) => left.row - right.row)) {
        SpreadsheetTool.setCellValue(sheet, item.row, COL_SRC_TEXT, item.src);
        SpreadsheetTool.setCellValue(sheet, item.row, COL_DST_TEXT, item.dst);
      }
      const target_path = path.join(paths.translated_path, rel_path);
      await write_xlsx_workbook(workbook, target_path);
    }
  }

  /**
   * ExcelJS 没有填充色时返回 -1，与 openpyxl 未设置颜色的过滤语义一致
   */
  private get_fg_color_index(sheet: ExcelJS.Worksheet, row: number, column: number): number {
    const fill = sheet.getCell(row, column).fill as
      | Partial<{ fgColor?: { indexed?: number } }>
      | undefined;
    return fill?.fgColor?.indexed ?? -1;
  }
}
