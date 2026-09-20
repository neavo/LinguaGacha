import { spreadsheet_fixture } from "../../test/spreadsheet-fixture";
import { expect, it } from "vitest";
import { cell_text, read_workbook, write_cell } from "./spreadsheet";

it("提取富文本、链接显示文字和公式缓存", () => {
  expect(cell_text({ richText: [{ text: "富" }, { text: "文本" }] })).toBe("富文本");
  expect(cell_text({ text: "文档", hyperlink: "https://example.com" })).toBe("文档");
  expect(cell_text({ formula: "1+1", result: 2 })).toBe("2");
});
it("工作簿读写保留既有样式，公式样内容按文本保存", async () => {
  const workbook = await read_workbook(await spreadsheet_fixture({ A1: { text: "old", fill: 9 } }));
  const sheet = workbook.worksheets[0]!;
  write_cell(sheet, 1, 1, "=SUM(A1:A2)");
  const loaded = await read_workbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
  expect(loaded.worksheets[0]!.getCell("A1").value).toBe("'=SUM(A1:A2)");
  expect(loaded.worksheets[0]!.getCell("A1").fill).toMatchObject({ fgColor: { indexed: 9 } });
});
