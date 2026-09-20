import ExcelJS from "exceljs";
import { Readable } from "node:stream";

type FixtureCell =
  | string
  | number
  | boolean
  | Date
  | { text?: string; rich?: string[]; formula?: string; result?: string; fill?: number };

/** 用真实工作簿准备单元格和 WOLF 索引色。 */
export async function spreadsheet_fixture(cells: Record<string, FixtureCell>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet");
  for (const [address, value] of Object.entries(cells)) {
    const cell = sheet.getCell(address);
    if (typeof value !== "object" || value instanceof Date) cell.value = value;
    else {
      cell.value =
        value.formula !== undefined
          ? { formula: value.formula, result: value.result }
          : value.rich
            ? { richText: value.rich.map((text) => ({ text })) }
            : (value.text ?? "");
      if (value.fill !== undefined) {
        const color: Partial<ExcelJS.Color> & { indexed: number } = { indexed: value.fill };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: color };
      }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 读取实际写出的首张表，断言字段位置和保留内容。 */
export async function spreadsheet_values(
  bytes: Uint8Array,
): Promise<Record<string, ExcelJS.CellValue>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.from([bytes]));
  const values: Record<string, ExcelJS.CellValue> = {};
  workbook.worksheets[0]?.eachRow((row) =>
    row.eachCell((cell) => {
      values[cell.address] = cell.value;
    }),
  );
  return values;
}
