import ExcelJS from "exceljs";

/**
 * 集中加载 XLSX 工作簿，隐藏 ExcelJS 对 Buffer 类型的宽松签名。
 */
export async function load_workbook(content: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx.load as (data: unknown) => Promise<ExcelJS.Workbook>)(Buffer.from(content));
  return workbook;
}

/**
 * 单元格文本兼容普通文本、富文本和公式结果，其他类型统一转字符串。
 */
export function cell_to_text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part ? String(part.text ?? "") : "",
      )
      .join("");
  }
  if (typeof value === "object" && "result" in value) {
    return String(value.result ?? "");
  }
  return String(value);
}

/**
 * WOLF 表格通过前四列表头识别，避免普通双列表被专用解析器抢走。
 */
export function is_wolf_sheet(sheet: ExcelJS.Worksheet): boolean {
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
