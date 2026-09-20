import ExcelJS, { type CellValue, type Worksheet } from "exceljs";

/** 统一二进制加载边界；ExcelJS 类型声明的 Buffer 与当前 Node 类型有差异。 */
export async function read_workbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

/** 文件导入消费文字或公式缓存；富文本、链接和日期按原有文本化语义读取。 */
export function cell_text(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return value.text;
  if (typeof value === "object" && "richText" in value)
    return value.richText.map((part) => part.text).join("");
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value);
}

/** WOLF 仅改内容，保留原样式；新建双列表和规则表显式指定基础样式。 */
export function write_cell(
  sheet: Worksheet,
  row: number,
  column: number,
  value: CellValue,
  font_size?: number,
): void {
  const cell = sheet.getCell(row, column);
  cell.value = typeof value === "string" && value.startsWith("=") ? "'" + value : (value ?? "");
  if (font_size !== undefined) {
    cell.font = { size: font_size };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "left" };
  }
}
