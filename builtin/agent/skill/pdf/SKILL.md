---
name: pdf
description: 读取、分析和处理 PDF，提取文字与页面信息，结合页面图像理解内容，并支持工程 PDF 的翻译、预览和导出。
---

# PDF

## 读取与看图

1. 读取 `ws.contract`、`project_meta` 和 `ws.contract.datasets.pdf` 指向的 JSONL。每行是一个原稿页，身份为 `file_path` 与 `page`，`fp` 用于该页提交，完整载荷以数据集的 `schema` 为准。
2. 页码从 1 开始，同一文件的页面按原稿顺序排列。原稿路径来自 `project_meta.files[].source_binary_path`。直接导入 `mupdf`，一次打开文档并按需批量提取文字、字体与坐标，把调查材料存入 `work`。
3. 在 JS 中用 `@lg/pdf` 的 `render_pdf_page` 渲染已打开文档的页面或区域，保存到 `work`，再用 `await ws.emitImage(path)` 把图片交给模型。多栏、表格、图注、公式和无提取文本的页面结合图像判断。跨页内容连同相邻页阅读。
4. MuPDF 文档、页面和提取结果用 `try/finally` 与 `destroy()` 释放。同一程序复用文档，处理完一页及时释放页面和图片。区域坐标采用旋转后、左上角原点的 `scale=1` 页面坐标，放大只改变 `scale`。

## 翻译与续做

翻译时加载 `translation-rules`，遵循用户范围、工程语言和 `report` / `apply`。

正式译稿按原稿页独立保存。每次提交该页完整的 `translation`、`reviewed` 和 `notes`，未提交页自动保留。`translation` 有三种状态：

- `null`：输出原页，也用于恢复原文。
- `{ kind: "translate", markdown, background? }`：输出归属于该页的译文，`markdown` 可为空。
- `{ kind: "omit", reason }`：按用户要求省略该原页，`reason` 必须说明原因。

跨页段落、表格和图注由 Agent 决定归属。可以把完整内容放在其中一页，其余已被接管的页面提交空译稿，并在 `notes` 说明内容去向。空译稿不恢复原文、不生成空白页，也不打断连续正文。尚未整理完整的页面先在 `work` 留草稿，避免局部正文替换整页造成遗漏。跨页调整提交涉及的全部页面，并根据逐页回执修复失败页。

译文采用所属原页的可见尺寸。相邻有正文的译稿尺寸和背景相同时连续排版，尺寸或背景改变时开始新页，译文页数可以增加。保留原页和省略页结束当前连续排版。保存允许暂时全部为空译稿或省略，预览与导出要求至少有一张输出页。

Markdown 每页独立校验和编译，支持标题、强调、列表、引用、代码、GFM 表格列对齐、提示块、公式和编号注释。`reviewed` 是独立的核对记录，不能自动证明正文完整，`notes` 保存该页待办和续做说明。

图片写为 `![译文图注](pdf-image:DIGEST/PAGE/X,Y,WIDTH,HEIGHT)`，`DIGEST` 使用当前 `digest`，区域位于对应原页。地图、图表和公式截图属于正文插图。裁剪应保留标记、比例尺和必要图例，按标题、图片、连续说明组织，避免图注与标题重复或图片打断编号说明。

`background: { page, x, y, width, height }` 只引用本原稿的干净装饰区域，按比例覆盖该页译稿生成的输出页且不占正文空间。先看图确认区域不含正文或地图；整页截图中的原文也会叠印到译文后方。装饰页是否省略由用户要求决定，不能根据没有提取文字自动判定。

行内公式使用 `$...$`，独立公式使用 `$$` 单独成行的块。货币美元符号使用 `\$`，普通代码保持字面内容。提示块使用 `> [!NOTE]`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`。注释使用 `[^id]` 与 `[^id]: 内容`，引用和定义放在同一页译稿，输出在该页译稿末尾并提供回链。公式错误会附带原页码与行列位置拒绝提交，应修正，或在确实需要时使用清晰的原稿截图。

链接使用 HTTP(S)、`mailto:` 或按当前页译稿标题出现顺序编号的页内锚点 `#heading-1`、`#heading-2`。原始 HTML 标签与注释按字面文本输出，换行使用 Markdown 语法。应用控制字体、HTML、样式和资源加载。

核对遗漏、表格数字、图例、术语与引用后更新该页 `reviewed`，并在 `notes` 记录待办和排除内容的理由。

## 保存与导出

1. 在 `ws.contract.changes.pdf.updates` 指定的 JSONL 中，每行写入一个页面的 `file_path`、`page`、当前页 `fp`、`translation`、`reviewed` 和 `notes`。同批同页只写一次。
2. `report` 保存方案与草稿；`apply` 使用 `workspace_apply`，读取逐页回执。页面独立接受或拒绝，回执按文件和原页码定位，审批与 `applied.pdf.updated` 均按变化页数计数。
3. 指纹失效时重读页面快照，结合已保存 `work` 修正。原稿摘要变化会使该文件的旧页指纹失效，单页变化不影响邻页指纹。
4. 已提交译稿、核对记录和 `notes` 随 `.lg` 保存，停止、重置对话或重启后都以工程事实恢复。
5. 用本技能的 `scripts/preview.mjs` 生成预览，以返回的工作区 `path` 渲染并查看风险页面。默认读取本次页面快照，也可传入使用相同 `changes` 结构的草稿 JSONL 路径，按页覆盖快照副本后生成。修正后重新保存、核对。
6. 按用户需要导出已保存结果。在新的 `workspace_run` 中读取 `project_meta.files` 对应文件的最新 `pdf_fp`，作为 `ws.host` 的 `export_pdf` 请求的 `fp`。部分译稿与保留原页自动组合。

`export_pdf` 返回的 `output_path` 位于工作区外，按导出回执交付。回执分别统计翻译、保留与省略的原页数。视觉核验使用 `work` 中相同页面组合的预览，检查译文与保留原页的衔接、背景、公式、大图图注和长表格分页。译文排版后的页数可以不同于原稿页数。图片请求或宿主失败时保存续做说明并报告实际阻塞。

## JS 操作示例

先调用 `read_skill` 读取本技能，返回的 `workspace_path` 是只读技能包路径。重读会刷新副本；对话重置后重新读取。下面的 `import` 相对 `workspace_run` 自动保存的 `work/runs/*.mjs` 解析。

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

裁剪时传入 `region: { page, x, y, width, height }`，`region.page` 与请求 `page` 一致。

### 生成预览

```js
import { preview } from '../../skills/pdf/scripts/preview.mjs';
console.log(await preview('book.pdf', 'work/pdf-updates.jsonl'));
```

省略第二个参数时使用工程快照译稿。预览复用 `@lg/pdf` 的正式生成入口，经 `print_pdf` 打印到 `work`。静态 HTML 也可用 `ws.host({ kind: 'print_pdf', html })` 打印为工作材料，正式交付使用工程导出。

### 导出当前译稿与原页

```js
import { readFile } from 'node:fs/promises';
const meta = JSON.parse(await readFile(ws.contract.datasets.project_meta.path, 'utf8'));
const file = meta.files.find(file => file.file_path === 'book.pdf');
console.log(await ws.host({ kind: 'export_pdf', file_path: file.file_path, fp: file.pdf_fp }));
```
