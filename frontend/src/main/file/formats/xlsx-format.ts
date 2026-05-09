import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

import { group_items, type ExportPaths } from "./file-format-shared";
import { normalize_file_item, type FileFormatItem } from "../file-item";
import { cell_to_text, is_wolf_sheet, load_workbook } from "./xlsx-shared";

/**
 * 通用双列表格格式，第一列原文、第二列译文。
 */
export class XLSXFormat {
  /**
   * WOLF 专用表头由 WOLFXLSXFormat 处理，普通格式在这里按双列读取。
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<FileFormatItem[]> {
    const workbook = await load_workbook(content);
    const sheet = workbook.worksheets[0];
    if (sheet === undefined || is_wolf_sheet(sheet)) {
      return [];
    }
    const items: FileFormatItem[] = [];
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      const src_value = sheet.getCell(row, 1).value;
      if (src_value === null || src_value === undefined) {
        continue;
      }
      const dst_value = sheet.getCell(row, 2).value;
      const src = cell_to_text(src_value);
      const dst = dst_value === null || dst_value === undefined ? "" : cell_to_text(dst_value);
      items.push(
        normalize_file_item({
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
  public async write_to_path(items: FileFormatItem[], paths: ExportPaths): Promise<void> {
    for (const [rel_path, group] of group_items(items, "XLSX")) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Sheet");
      sheet.getColumn(1).width = 64;
      sheet.getColumn(2).width = 64;
      for (const item of group.sort((left, right) => left.row - right.row)) {
        sheet.getCell(item.row, 1).value = item.src;
        sheet.getCell(item.row, 2).value = item.dst;
      }
      const target_path = path.join(paths.translated_path, rel_path);
      fs.mkdirSync(path.dirname(target_path), { recursive: true });
      await workbook.xlsx.writeFile(target_path);
    }
  }
}
