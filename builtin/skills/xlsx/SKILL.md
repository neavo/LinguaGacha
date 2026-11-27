---
name: xlsx
description: 翻译、审校、分析、修改或生成 XLSX 工作簿前必须加载
---

内置解析器不识别 XLSX 工作簿，工程原稿经 `generic-package` 封装为 `.generic` 资产进入工程。处理 XLSX 通用包时同时加载 `generic-package`。工作区已预置 `exceljs`，无需额外安装，接口细节查 `node_modules/exceljs/` 的 `README.md` 或 `index.d.ts`。

# 来源调查

按材料形态确定处理入口：

|材料形态|识别特征|处理入口|
|---|---|---|
|原始 `.xlsx` 文件|上传目录或本机 `.xlsx`，不属于内置解析器范围|调查结构后按「导入准备」封装为 `.generic`|
|正式 XLSX 通用包|`.generic` 资产，展开目录含底稿工作簿、写回脚本、`README.md` 与 `items.json`|按包内定位说明与当前契约处理或写回|
|旧版迁移包|`.generic` 资产，展开目录含 `source.xlsx` 且 `items.json` 记录含 `sheet_row` 或 `legacy_file_type`（缺少 `README.md` 时同样据此识别）|直接沿用已有条目，写回按「写回与验证」的旧迁移包规则处理|
|工程外独立工作簿|用户明确要求不入工程、仅读取或输出修改稿|转「生成独立 XLSX」|

调查工作簿结构时，使用 `exceljs` 先列工作表清单和少量样例，再确认以下事实：

- **表与列语义**：目标工作表、表头行、原文列、译文列、可选角色名或备注列，以及需跳过的表和行。
- **单元格值形态**：富文本从 `richText` 各段拼接文字，超链接读取 `text`，公式读取已有 `result` 时注明其为缓存值；缓存缺失时说明该单元格结果未知。
- **WOLF 导出表特征**：首表首行含 `code`、`flag`、`type`、`info`，正文通常在 F/G 列，原文单元格索引色 `9` 标记待译资格。

# 导入准备

按 `generic-package` 封包流程，在 `work/` 的专用目录中准备以下成员并封装为 `.generic`：

1. **冻结底稿**：保存原始工作簿（如 `source.xlsx`），提取结果严格对应这份底稿。
2. **生成 `items.json`**：每条记录保留 `message` 与可选字符串 `name`（无姓名时省略该键，不写 `null`），并附带写回所需的私有定位，至少包含工作表名与单元格坐标。
3. **随包保存恢复材料**：放入可复用的写回脚本、依赖声明（注明使用预置 `exceljs`）及 `README.md`，说明适用技能（`xlsx`、`generic-package`）、目标工作表、列语义、定位字段与写回约束。
4. **校验与封包**：按 `generic-package` 用代表样本确认未改动往返与真实译文写回，调用 `@lg/generic` 的 `read_generic_items()` 校验记录并用 `pack()` 封包，再交回 `project-operation` 识别与提交。

# 原稿与条目

通用包展开在 `sources/<file_path>/`，条目 `row_number` 与 `items.json` 的数组下标一一对应，私有定位只保留在包内。

旧版迁移包中，`sheet_row` 是从 `1` 开始的工作表行号，按 `legacy_file_type` 确定默认列布局：

|原资产类型|默认列布局|
|---|---|
|`XLSX`|首表 A 列原文、B 列译文|
|`WOLFXLSX`|首表 F 列原文、G 列译文（原文单元格索引色 `9` 标记待译资格）|
|`NONE`|无历史类型记录，按底稿 `source.xlsx` 实查工作表与列布局|

# 写回与验证

## 状态与目标值对齐

消费同一工程版本的 `items/entries.jsonl` 与 `generateFiles()` 返回的写回输入（`<writeback.input_path>/<file_path>/items.json`），以 `file_path` 和 `row_number` 对齐完成状态与最终文本：

|条目状态|写回行为|
|---|---|
|`PROCESSED`|写入写回输入中的最终文本；已完成空译文清空目标单元格，已完成同文译文照常写回|
|`DUPLICATED`|仅当同文件、同原文、同原名组内存在 `PROCESSED` 条目时写入该译文（写回输入已按此填充），否则按未完成处理|
|其余未完成状态|不修改目标单元格，保留原工作簿中的值与样式|

## 工作簿写回与核对

- **执行入口**：正式包先阅读并检查包内写回脚本源码后再执行；旧版迁移包无内置脚本，结合底稿 `source.xlsx` 与 `sheet_row`、`legacy_file_type` 直接写回。
- **结构保真**：从包内原工作簿启动，只修改已完成行的目标单元格，保留其他工作表、非目标单元格、公式、合并区域、样式和资源。
- **公式防护**：以 `=` 开头的普通译文必须按文本写入（例如加前导 `'` 或写入富文本），避免被表格软件解释为公式；仅在明确需要公式时写入公式对象。
- **读回验证**：写出后用 `exceljs` 重新读取产物，逐项核对已完成行的目标值、未完成行的原值，以及需保留的工作表与样式结构。

# 交付说明

- **仅单语交付**：XLSX 资产仅交付单语工作簿，不生成双语目录。
- **恢复格式后缀**：正式包去掉末尾 `.generic`；带迁移避让后缀的包（如 `book.xlsx_2.generic`）按底稿成员恢复为 `.xlsx` 后缀。
- **限制说明**：工作簿含复杂图表、宏或依赖外部重算的公式缓存时，交付时提醒用户在表格软件中复核。

# 生成独立 XLSX

仅在用户明确要求工程外独立工作簿时执行，不写入工程。修改稿写入 `work/`，复用原工作簿只更新目标单元格，同样遵守公式防护和结构保真约束：

```js
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile('uploads/角色设定.xlsx');
const sheet = workbook.getWorksheet('角色');
const text = '修改后的文字';
sheet.getCell('B2').value = text.startsWith('=') ? `'${text}` : text;
await workbook.xlsx.writeFile('work/角色设定.xlsx');

const check = new ExcelJS.Workbook();
await check.xlsx.readFile('work/角色设定.xlsx');
console.log(check.getWorksheet(sheet.name).getCell('B2').value);
```

写出后重新读取并核对目标单元格与需保留的工作簿结构。
