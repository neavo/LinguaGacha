---
name: pdf
description: 读取、分析和处理 PDF，提取文字与页面信息，结合页面图像理解内容，并支持工程 PDF 的翻译、预览和导出。
---

# PDF

## 读取与看图

1. 读取 `ws.contract`、`project_meta` 和 `ws.contract.datasets.pdf` 指向的 JSONL。每行包含 `file_path`、`fp`、`source` 和 `translation`。
2. `source` 提供原稿摘要和 PDFPage 数组，页码从 1 开始。原稿路径来自 `project_meta.files[].source_binary_path`。直接导入 `mupdf`，一次打开文档并按需批量提取文字、字体与坐标，把调查材料存入 work。
3. 在 JS 中用 `@lg/pdf` 的 `render_pdf_page` 渲染已打开文档的页面或区域，保存到 work，再用 `await ws.emitImage(path)` 把图片交给模型。多栏、表格、图注、公式和无提取文本的页面结合图像判断。跨页内容连同相邻页阅读。
4. MuPDF 文档、页面和提取结果用 `try/finally` 与 `destroy()` 释放。同一程序复用文档，处理完一页及时释放页面和图片。区域坐标采用旋转后、左上角原点的 scale=1 页面坐标，放大只改变 scale。

## 翻译与续做

翻译时加载 `translation-rules`，遵循用户范围、工程语言和 `report / apply`。

正式译稿由 `translation.sections` 按原页顺序保存。每段包含 `kind`、`page_start` 和 `page_end`，页码从 1 开始且包含两端，范围不能重叠。`kind: "translate"` 携带非空 `markdown`，完整替换所声明原页范围，跨页段落或表格可放进同一连续范围。`kind: "omit"` 携带非空 `reason`，用于用户要求省略的装饰空页等范围。未覆盖的范围保留原始页面；整份输出至少保留一页。

译文采用该段首个原页的可见尺寸。原页范围连续、页面尺寸和背景相同的翻译段连续排版；尺寸或背景改变时开始新页，译文页数可以增加。

按用户指定范围选择完整单元。尚未整理完整的单元先保存在 work，正文覆盖完整范围后再提交，避免局部译文替换整页而遗漏内容。修改一个范围时读取并保留其它已保存段。

完整载荷以 datasets.pdf 的 Schema 为准。`sections` 为空或删除某段会恢复对应原页；`reviewed_pages` 保存已核对原页，`notes` 保存待办和续做说明。Markdown 支持标题、强调、列表、引用、代码、GFM 表格列对齐、提示块、公式和编号注释。

图片写为 `![译文图注](pdf-image:DIGEST/PAGE/X,Y,WIDTH,HEIGHT)`，DIGEST 使用当前 source.digest，区域位于对应原页。地图、图表和公式截图属于正文插图。裁剪应保留标记、比例尺和必要图例，按标题、图片、连续说明组织，避免图注与标题重复或图片打断编号说明。

`background: { page, x, y, width, height }` 只引用本原稿的干净装饰区域，按比例覆盖该段输出页且不占正文空间。先看图确认区域不含正文或地图；整页截图中的原文也会叠印到译文后方。装饰页是否省略由用户要求决定，不能根据没有提取文字自动判定。

行内公式使用 `$...$`，独立公式使用 `$$` 单独成行的块。货币美元符号使用 `\$`，普通代码保持字面内容。提示块使用 `> [!NOTE]`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`。注释使用 `[^id]` 与 `[^id]: 内容`，引用和定义放在同一翻译段，输出在段末并提供回链。公式错误会附带段范围与行列位置拒绝提交，应修正，或在确实需要时使用清晰的原稿截图。

链接使用 HTTP(S)、mailto 或按当前段标题出现顺序编号的段内锚点 `#heading-1`、`#heading-2`。原始 HTML 标签与注释按字面文本输出，换行使用 Markdown 语法。应用控制字体、HTML、样式和资源加载。

核对遗漏、表格数字、图例、术语与引用后更新 reviewed_pages，并在 notes 记录待办和排除内容的理由。核对记录不代表正文自动完整。

## 保存与导出

1. 把包含全部译稿段的完整 PDFTranslation JSON 保存到 `work` 内。一次提交同时保存正文、核对记录和续做说明。
2. 在 `ws.contract.changes.pdf.updates` 指定 JSONL 中写入 `file_path`、当前 `fp` 和 `translation_path`。路径指向上述 work 文件。
3. report 保存方案和证据；apply 使用 `workspace_apply`，读取实际回执。一份文档整体接受或拒绝，同批每份文件只写一次。
4. 旧指纹被拒绝时重读工程事实，结合已保存 work 修正。已提交译稿、核对记录和 notes 随 .lg 保存，停止、重置对话或重启后都以工程事实恢复。
5. 用本技能的 `scripts/preview.mjs` 生成预览，以返回的工作区 path 渲染并查看风险页面。脚本默认读取本次工程快照，也可传入 work 中的草稿路径，在 report 模式下先核对版式。修正内容后重新保存、核对。
6. 按用户需要导出当前保存结果。在新的 workspace_run 中读取最新 fp，用 `ws.host` 的 `export_pdf` 导出。部分译稿与未翻译原页自动组合；没有译稿时直接输出原文。

export 返回的 output_path 位于工作区外，按导出回执交付。回执分别统计翻译、保留与省略的原页数。视觉核验使用 work 中相同页面组合的预览，检查译文与保留原页的衔接、背景、公式、大图图注和长表格分页。译文排版后的页数可以不同于原页范围。图片请求或宿主失败时保存续做说明并报告实际阻塞。

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

裁剪时传入 `region: { page, x, y, width, height }`，region.page 与请求 page 一致。

### 生成预览

```js
import { preview } from '../../skills/pdf/scripts/preview.mjs';
console.log(await preview('book.pdf', 'work/translation.json'));
```

省略第二个参数时使用工程快照译稿。预览复用 `@lg/pdf` 的正式生成入口，经 print_pdf 打印到 work。静态 HTML 也可用 `ws.host({ kind: 'print_pdf', html })` 打印为工作材料，正式交付使用工程导出。

### 导出当前译稿与原页

```js
import { readFile } from 'node:fs/promises';
const documents = (await readFile(ws.contract.datasets.pdf.path, 'utf8'))
  .split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
const document = documents.find(row => row.file_path === 'book.pdf');
console.log(await ws.host({ kind: 'export_pdf', file_path: document.file_path, fp: document.fp }));
```
