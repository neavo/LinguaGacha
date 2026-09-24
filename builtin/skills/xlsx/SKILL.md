---
name: xlsx
description: 读取、分析、编辑或生成 XLSX 表格时使用，处理工作表、单元格、公式缓存和格式保留。
---

# XLSX 文件处理

使用预装 `exceljs`，先确认目标工作表、列语义和处理范围。读取大表时先列出工作表及少量样例，按任务选择需要的行列，结果保留工作表名和单元格位置。

```js
import ExcelJS from 'exceljs';
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('sources/资料/角色设定.xlsx');
console.log(workbook.worksheets.map(sheet => ({ name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount })));
const sheet = workbook.worksheets[0];
if (!sheet) throw new Error('工作簿没有工作表');
for (let row = 1; row <= Math.min(sheet.rowCount, 10); row++) {
  console.log({ row, values: sheet.getRow(row).values });
}
```

具体接口读取 `node_modules/exceljs/README.md` 或 `index.d.ts`。富文本从 `richText` 各段取得文字，超链接使用 `text`，公式使用已有 `result` 时注明它是文件中的缓存值。ExcelJS 读取已有公式缓存，缓存缺失时说明该单元格结果未知。

修改已有文件时复用原工作簿，只更新目标单元格。普通文本通过 `cell.value` 写入字符串，公式使用公式对象。保留其他工作表、合并区域、样式和资源。

```js
sheet.getCell('B2').value = '修改后的文字';
await workbook.xlsx.writeFile('work/角色设定.xlsx');
const check = new ExcelJS.Workbook();
await check.xlsx.readFile('work/角色设定.xlsx');
console.log(check.getWorksheet(sheet.name).getCell('B2').value);
```

写出后重新读取并核对目标内容和任务要求保留的结构。复杂图表、宏或未明确支持的工作簿特性需要单独核验。WOLF 表格具有固定列及填充色规则，检查原表后再定位原文和译文列。工程翻译结果仍通过工程提交契约保存。
