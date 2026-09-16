---
name: pdf
description: 读取、分析和处理 PDF，提取文字与页面信息，结合页面图像理解内容，并支持工程 PDF 的翻译、预览和导出。
---

# PDF

按用户任务读取、分析或处理 PDF，结合文字提取与页面图像理解内容。工程 PDF 以 PDFDocument 保存原稿信息与正式译稿。

## 读取与看图

1. 读取 `ws.contract`、`project_meta` 和 `ws.contract.datasets.pdf` 指向的 JSONL。每行包含 `file_path`、`fp`、`source` 和 `translation`。
2. `source` 提供原稿摘要和 PDFPage 数组，页码从 1 开始。原稿路径来自 `project_meta.files[].source_binary_path`。直接导入 `mupdf`，一次打开文档并按需批量提取文字、字体与坐标，把调查材料存入 work。
3. 在 JS 中用 `@lg/pdf` 的 `render_pdf_page` 渲染已打开文档的页面或区域，保存到 work，再用 `await ws.emitImage(path)` 把图片交给模型。多栏、表格、图注、公式和无提取文本的页面结合图像判断。跨页内容连同相邻页阅读。
4. MuPDF 文档、页面和提取结果用 `try/finally` 与 `destroy()` 释放。同一程序复用文档，处理完一页及时释放页面和图片。区域坐标采用旋转后、左上角原点的 scale=1 页面坐标，放大只改变 scale。

## 翻译与续做

执行翻译任务时加载 `translation-rules`，沿用用户范围、工程语言和 `report / apply` 决定。PDF 由 Agent 整理、翻译和核对，按下文保存译稿与完成交付。

正式译稿由 `translation.sections` 按原页顺序保存。每段包含 `page_start`、`page_end` 和 `markdown`，页码从 1 开始且包含两端，范围不能重叠。每段译稿完整替换所声明原页范围的内容，跨页段落或表格可放进同一连续范围。相邻段导出时连续排版，缺少译稿的范围保留原始页面。

按用户指定范围选择完整单元。尚未整理完整的单元先保存在 work，正文覆盖完整范围后再提交，避免局部译文替换整页而遗漏内容。修改一个范围时读取并保留其它已保存段。

PDFTranslation 的完整形状见 datasets.pdf 的 Schema：

- `sections`：有序译稿段，每段 Markdown 非空，支持标题、强调、列表、引用、代码和简单表格。空数组表示全部保留原文，删除某段恢复对应原页。
- `reviewed_pages`：已经结合原稿核对的页码，逐步更新。
- `notes`：剩余范围、跨页接续、术语与需复核问题。重开工程后据此继续。

图片写为 `![译文图注](pdf-image:DIGEST/PAGE/X,Y,WIDTH,HEIGHT)`，DIGEST 使用当前 source.digest，区域位于对应原页。公式和复杂图表按可读性保留原图并附译文说明。链接使用 HTTP(S)、mailto 或按当前段标题出现顺序编号的段内锚点 `#heading-1`、`#heading-2`。原始 HTML 标签与注释按字面文本输出，换行使用 Markdown 语法。应用控制 HTML 和资源加载。

核对页码表达独立工作记录，修改译稿时同步维护对应核对记录和说明。译稿范围决定替换哪些原页。实际仍需检查遗漏、表格数字、图例、术语和引用。明确排除的原稿内容在 notes 记录理由。译稿正文按用户要求交付。

## 保存与导出

1. 把包含全部译稿段的完整 PDFTranslation JSON 保存到 `work` 内。一次提交同时保存正文、核对记录和续做说明。
2. 在 `ws.contract.changes.pdf.updates` 指定 JSONL 中写入 `file_path`、当前 `fp` 和 `translation_path`。路径指向上述 work 文件。
3. report 保存方案和证据；apply 使用 `workspace_apply`，读取实际回执。一份文档整体接受或拒绝，同批每份文件只写一次。
4. 旧指纹被拒绝时重读工程事实，结合已保存 work 修正。已提交译稿、核对记录和 notes 随 .lg 保存，停止、重置对话或重启后都以工程事实恢复。
5. 用本技能的 `scripts/preview.mjs` 生成预览，以返回的工作区 path 渲染并查看风险页面。脚本默认读取本次工程快照，也可传入 work 中的草稿路径，在 report 模式下先核对版式。修正内容后重新保存、核对。
6. 按用户需要导出当前保存结果。在新的 workspace_run 中读取最新 fp，用 `ws.host` 的 `export_pdf` 导出。部分译稿与未翻译原页自动组合；没有译稿时直接输出原文。

export 返回的 output_path 位于工作区外，按导出回执交付。视觉核验使用 work 中相同页面组合的预览，检查译文与保留原页的衔接。译文排版后的页数可以不同于原页范围。图片请求或宿主失败时保存续做说明并报告实际阻塞。

## JS 操作示例

先调用 `read_skill` 读取本技能，返回的 `workspace_path` 是只读技能包路径。重读会刷新副本；对话重置后重新读取。下面的 import 相对 workspace_run 自动保存的 `work/runs/*.mjs` 解析。

### 提取文字与位置

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
const meta = JSON.parse(await readFile(ws.contract.datasets.project_meta.path, 'utf8'));
const source = meta.files.find(file => file.file_path === 'book.pdf');
const pdf = new mupdf.PDFDocument(new Uint8Array(await readFile(source.source_binary_path)));
try {
  const page = pdf.loadPage(0); // MuPDF 页索引从 0 开始，工程页码从 1 开始。
  try {
    const text = page.toStructuredText('');
    try { await writeFile('work/page-1.json', text.asJSON()); }
    finally { text.destroy(); }
  } finally { page.destroy(); }
  console.log({ pages: pdf.countPages() });
} finally { pdf.destroy(); }

```

提取顺序只作为调查证据。跨页与多栏的阅读顺序结合页面图像决定。

### 渲染与裁剪

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
import { render_pdf_page } from '@lg/pdf';
const pdf = new mupdf.PDFDocument(new Uint8Array(await readFile('sources/book.pdf/original.pdf')));
try {
  for (const page of [1, 2]) {
    const path = 'work/page-' + page + '.png';
    await writeFile(path, render_pdf_page(pdf, { page, scale: 1.5 }));
    await ws.emitImage(path);
  }
} finally { pdf.destroy(); }
```

原稿路径使用 project_meta 给出的 source_binary_path，预览使用生成的 work 路径。需要裁剪时传入 `region: { page, x, y, width, height }`，region.page 与请求 page 一致。一次程序处理一批所需页面，按需提高局部图像分辨率。

### 生成预览

```js
import { preview } from '../../skills/pdf/scripts/preview.mjs';
console.log(await preview('book.pdf', 'work/translation.json'));
```

省略第二个参数时使用工程快照译稿。脚本直接导入 `@lg/pdf`，与正式输出共用校验、排版和页面合并，在本进程通过 MuPDF 嵌入原图，并通过 print_pdf 完成打印。输出同时包含译文和保留的原页。按任务需要阅读、导入或组合此模块。静态 HTML 也可通过 `ws.host({ kind: 'print_pdf', html })` 打印到 work；它只是工作材料，正式交付仍从工程导出。

### 导出当前译稿与原页

```js
import { readFile } from 'node:fs/promises';
const documents = (await readFile(ws.contract.datasets.pdf.path, 'utf8'))
  .split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
const document = documents.find(row => row.file_path === 'book.pdf');
console.log(await ws.host({ kind: 'export_pdf', file_path: document.file_path, fp: document.fp }));
```

宿主校验版本并沿导出服务读取当前保存的译稿范围，输出目录由工程设置决定。版本变化时重读快照并核对，避免交付未经确认的译稿。
