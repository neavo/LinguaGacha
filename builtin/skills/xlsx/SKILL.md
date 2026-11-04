---
name: xlsx
description: 读取、分析或翻译 XLSX 表格时使用。用户要求生成或编辑工程外的独立 XLSX 文件时也使用。
---

# XLSX 文件处理

工程内的翻译与审校按 `translation` 执行。本技能用于阅读结构、补充语境，以及用户明确要求的工程外独立文件。

## 阅读表格

使用 `exceljs`，先确认目标工作表、列语义和处理范围。读取大表时先列出工作表及少量样例，按任务选择需要的行列，结果保留工作表名和单元格位置。

具体接口读取共享 npm 工程中 `node_modules/exceljs/` 的 `README.md` 或 `index.d.ts`。富文本从 `richText` 各段取得文字，超链接使用 `text`，公式使用已有 `result` 时注明它是文件中的缓存值。ExcelJS 读取已有公式缓存，缓存缺失时说明该单元格结果未知。

## 生成独立 XLSX

仅在用户明确要求工程外的独立文件时执行，独立文件不会写入工程。修改稿写入 `work/`，复用原工作簿，只更新目标单元格。普通文本通过 `cell.value` 写入字符串，公式使用公式对象。保留其他工作表、合并区域、样式和资源。

```js
import ExcelJS from 'exceljs';
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('sources/资料/角色设定.xlsx');
const sheet = workbook.getWorksheet('角色');
sheet.getCell('B2').value = '修改后的文字';
await workbook.xlsx.writeFile('work/角色设定.xlsx');
const check = new ExcelJS.Workbook();
await check.xlsx.readFile('work/角色设定.xlsx');
console.log(check.getWorksheet(sheet.name).getCell('B2').value);
```

写出后重新读取并核对目标内容和任务要求保留的结构。复杂图表、宏或未明确支持的工作簿特性需要单独核验。
