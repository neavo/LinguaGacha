import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

import { group_items, type ExportPaths } from "./file-format-shared";
import { normalize_file_item, type FileFormatItem } from "../file-item";
import { cell_to_text, is_wolf_sheet, load_workbook } from "./xlsx-shared";

// WOLF XLSX 的源文和译文列号来自 Py 侧固定实现。
const COL_SRC_TEXT = 6;
const COL_DST_TEXT = 7;
// 只有白色填充的源文列参与翻译，其它颜色被视为 WOLF 排除项。
const FILL_COLOR_WHITELIST = new Set([9]);

/**
 * WOLF RPG 导出的专用 XLSX 格式，列结构和填充色过滤对齐 Py 侧。
 */
export class WOLFXLSXFormat {
  /**
   * 只处理识别为 WOLF 表头的工作表，普通 XLSX 留给 XLSXFormat。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<FileFormatItem[]> {
    const workbook = await load_workbook(content);
    const sheet = workbook.worksheets[0];
    if (sheet === undefined || !is_wolf_sheet(sheet)) {
      return [];
    }
    const items: FileFormatItem[] = [];
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const src_value = sheet.getCell(row, COL_SRC_TEXT).value;
      if (src_value === null || src_value === undefined) {
        continue;
      }
      const dst_value = sheet.getCell(row, COL_DST_TEXT).value;
      const src = cell_to_text(src_value);
      const dst = dst_value === null || dst_value === undefined ? "" : cell_to_text(dst_value);
      const fill_index = this.get_fg_color_index(sheet, row, COL_SRC_TEXT);
      items.push(
        normalize_file_item({
          src,
          dst,
          row,
          file_type: "WOLFXLSX",
          file_path: rel_path,
          text_type: "WOLF",
          status:
            src === "" || !FILL_COLOR_WHITELIST.has(fill_index)
              ? "EXCLUDED"
              : dst !== "" && src !== dst
                ? "PROCESSED"
                : "NONE",
        }),
      );
    }
    return items;
  }

  /**
   * 写回时优先复用原始工作簿，避免破坏 WOLF 表格的其它列。
   */
  public async write_to_path(
    items: FileFormatItem[],
    paths: ExportPaths,
    asset_reader: (rel_path: string) => Buffer | null,
  ): Promise<void> {
    for (const [rel_path, group] of group_items(items, "WOLFXLSX")) {
      const original = asset_reader(rel_path);
      const workbook = original !== null ? await load_workbook(original) : new ExcelJS.Workbook();
      const sheet = workbook.worksheets[0] ?? workbook.addWorksheet("Sheet");
      if (original === null) {
        sheet.getColumn(1).width = 64;
        sheet.getColumn(2).width = 64;
      }
      for (const item of group.sort((left, right) => left.row - right.row)) {
        sheet.getCell(item.row, COL_SRC_TEXT).value = item.src;
        sheet.getCell(item.row, COL_DST_TEXT).value = item.dst;
      }
      const target_path = path.join(paths.translated_path, rel_path);
      fs.mkdirSync(path.dirname(target_path), { recursive: true });
      await workbook.xlsx.writeFile(target_path);
    }
  }

  /**
   * ExcelJS 没有填充色时返回 -1，与 openpyxl 未设置颜色的过滤语义一致。
   */
  private get_fg_color_index(sheet: ExcelJS.Worksheet, row: number, column: number): number {
    const fill = sheet.getCell(row, column).fill as Partial<{ fgColor?: { indexed?: number } }>;
    return fill.fgColor?.indexed ?? -1;
  }
}
