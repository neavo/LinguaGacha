---
name: pdf
description: 涉及 PDF 阅读、文字与图像提取、页面定位、译稿保存、排版或预览时使用。
---

# PDF 处理能力

## 原稿与 `pages`

通过 `ws.contract.datasets.pages.path` 读取 `pages`，身份与字段以对应 `reference` 为准。`project_meta.files[].source_binary_path` 提供原稿路径。`page` 字段是从 1 开始的原稿页码，MuPDF 的页索引从 0 开始。

用 `mupdf` 提取文字、字体与坐标，用 `@lg/pdf` 的 `render_pdf_page` 渲染页面或区域，再通过 `ws.emitImage` 查看。多栏、表格、扫描页、图注和公式需要结合图像判断，跨页内容连同邻页读取。

区域坐标以旋转后的页面左上角为原点，按 `scale=1` 计算。放大图像时调整渲染 `scale`，`region.page` 须与请求页一致。

在同一程序中复用文档，用 `try/finally` 及时释放逐页资源、提取结果和文档。

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
import { render_pdf_page } from '@lg/pdf';
const meta = JSON.parse(await readFile(ws.contract.datasets.project_meta.path, 'utf8'));
const source = meta.files.find(file => file.file_path === 'book.pdf');
const document = new mupdf.PDFDocument(new Uint8Array(await readFile(source.source_binary_path)));
try {
  const page = document.loadPage(0);
  try {
    const text = page.toStructuredText('');
    try { await writeFile('work/page-1.json', text.asJSON()); }
    finally { text.destroy(); }
  } finally { page.destroy(); }
  await writeFile('work/page-1.png', render_pdf_page(document, { page: 1, scale: 1.5 }));
  await ws.emitImage('work/page-1.png');
} finally { document.destroy(); }
```

将示例文件名替换为当前工程中的文件名。裁剪使用 `region: { page, x, y, width, height }`。

## 保存页面译稿

每页保存完整的 `translation`、`reviewed` 和 `notes`。`translation` 的含义为：

|值|页面处置|
|---|---|
|`null`|待处理，导出暂用原页。恢复此值会清除完成处置|
|`{ kind: "translate", markdown, background? }`|输出归属该页的译稿，`markdown` 可以为空|
|`{ kind: "keep", reason }`|确认保留原页，`reason` 记录依据|
|`{ kind: "omit", reason }`|按用户要求省略原页，`reason` 记录原因|

译稿覆盖、确认保留和省略均计入完成。`reviewed` 记录内容核对，`notes` 保存待办与续做说明，两者不决定完成率。

跨页内容可以完整归入其中一页，其余已接管页面使用空译稿，并在相关 `notes` 中记录来源与去向。排版时跳过空译稿，直接衔接前后译稿。

每页载荷会整体替换已有值，局部修改也需准备完整页面内容。

译稿采用所属原页的可见尺寸。相邻正文译稿的尺寸和背景相同时连续排版，变化时开始新页。保留和省略页面会结束连续排版。输出页数可以增加。保存可暂时全部为空译稿或省略，预览与导出至少需要一张输出页。

## Markdown 与资源

每个原页的 Markdown 独立校验、编译，支持标题、强调、列表、引用、代码、GFM 表格列对齐、提示块、公式和编号注释。

- 图片使用 `![译文图注](pdf-image:DIGEST/PAGE/X,Y,WIDTH,HEIGHT)`，`DIGEST` 为当前原稿摘要，区域位于对应原页。地图、图表和公式截图作为正文插图，裁剪保留标记、比例尺及必要图例。
- `background: { page, x, y, width, height }` 引用本原稿的干净装饰区域，按比例覆盖译稿生成页且不占正文空间。先看图确认裁剪范围，背景中的文字和图形都会叠印到译稿上，因此应选择干净的装饰区域。
- 行内公式用 `$...$`，独立公式用单独成行的 `$$` 包围块，货币美元符号用 `\$`。公式错误按返回位置修正，确需截图时使用清晰原稿区域。
- 提示块使用 `> [!NOTE]`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`。注释以 `[^id]` 和 `[^id]: 内容` 表达，引用与定义放在同一原页译稿，输出在该页译稿末尾并提供回链。
- 链接支持 HTTP(S)、`mailto:` 和按当前原页译稿标题顺序编号的页内锚点 `#heading-1`、`#heading-2`。HTML 标签与注释按字面显示，换行使用 Markdown 语法，字体、样式及资源加载由应用控制。

## 保存与恢复

通过 `ws.contract.changes.pages.updates.path` 指定的 JSONL 提交，载荷按对应 `reference` 准备，每个 `page` 在同批提交一次。逐个 `page` 核对接受或拒绝回执，审批和 `applied.pages.updated` 按实际变化的 `pages` 数量计数。

跨页调整需要提交涉及的全部 `pages`。部分成功时结合逐页回执与最新快照恢复一致归属。单页变化不影响邻页指纹，原稿摘要变化会使该文件的旧指纹失效，此时重读快照并更新方案。

`page` 处置、`reviewed` 和 `notes` 随 `.lg` 保存。`work/` 保存临时材料，对话重置或应用重启后依据工程现值与已保存 `notes` 恢复。

## 预览与视觉检查

使用本包脚本生成工作区预览。`base_url` 取自本技能的 `read_skill` 返回值或显式注入，是原包根目录地址：

```js
const { preview } = await import(new URL('scripts/preview.mjs', base_url).href);
console.log(await preview('book.pdf', 'work/page-updates.jsonl'));
```

第二个参数是 `pages` 草稿的 JSONL 路径，格式须符合 `ws.contract.changes.pages.updates.reference` 中的更新要求。脚本用草稿覆盖快照副本，供提交前或只读方案预览。省略该参数时，使用当前工程快照。

脚本通过 `@lg/pdf` 的正式生成入口和宿主打印能力，将 PDF 保存到 `work/`。返回的 `path` 指向生成文件，可再次渲染查看。正式文件由用户通过应用导出。

视觉检查关注译文与保留原页衔接、背景、公式、大图与图注、长表格分页和实际阅读顺序。内容归属按 `page` 身份追踪，呈现问题按渲染后的输出页定位，修正后复查受影响输出。图片请求或宿主失败时保留材料并说明未完成的核验。

静态 HTML 工作材料也可通过 `ws.host({ kind: 'print_pdf', html })` 打印到 `work/` 目录，格式与权限遵循宿主契约。
