import type { CellValue, Worksheet } from "exceljs";

/**
 * ExcelJS 单元格工具，集中表格读写时的文本化、公式转义和基础样式规则
 */
export class SpreadsheetTool {
  /**
   * 读取单元格并转成去除首尾空白的文本，对齐旧版 openpyxl 工具行为
   */
  public static getCellValue(sheet: Worksheet, row: number, column: number): string {
    return this.cellValueToText(sheet.getCell(row, column).value).trim();
  }

  /**
   * 写入单元格文本并设置默认展示样式，避免 Excel 将用户文本误识别成公式
   */
  public static setCellValue(
    sheet: Worksheet,
    row: number,
    column: number,
    value: unknown,
    font_size = 9,
  ): void {
    const cell = sheet.getCell(row, column);
    cell.value = this.normalizeWritableValue(value);
    cell.font = { size: font_size };
    cell.alignment = {
      wrapText: true,
      vertical: "middle",
      horizontal: "left",
    };
  }

  /**
   * ExcelJS 可能把公式、富文本和超链接包装成对象，这里统一收敛成用户可见文本
   */
  public static cellValueToText(value: CellValue): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object" && "text" in value && typeof value.text === "string") {
      return value.text;
    }
    if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) =>
          typeof part === "object" && part !== null && "text" in part
            ? String(part.text ?? "")
            : "",
        )
        .join("");
    }
    if (typeof value === "object" && "result" in value) {
      return String(value.result ?? "");
    }
    return String(value);
  }

  /**
   * 空值按空字符串写入，以等号开头的字符串按文本写入，避免打开表格时触发公式
   */
  private static normalizeWritableValue(value: unknown): CellValue {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string" && value.startsWith("=")) {
      return `'${value}`;
    }
    return value as CellValue;
  }
}
