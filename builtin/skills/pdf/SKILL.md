---
name: pdf
description: 翻译、审校、分析、修改 PDF 文件前必须加载。
---

# PDF 处理能力

页面模型以 `translation` 的「页面模型」为准。本技能补充 PDF 专属的读取、译稿写法、排版和预览方法。

阶段导航：

|阶段入口|章节|
|---|---|
|原稿与条目|「原稿与条目」「应用接口」「阅读与定位」「准备完整译稿」|
|翻译后检查|「翻译后检查」「预览与核验」|
|交付说明|「交付说明」|

## 原稿与条目

通过 `ws.contract.datasets.pages.path` 读取 `pages`，身份与字段以对应 `reference` 为准。原稿读取位置为 `sources/<file_path>`。`page` 是从 1 开始的原稿页码，MuPDF 的页索引从 0 开始。

## 应用接口

PDF 接口以字节交换文档，MuPDF 对象只在所属实例内使用。

|入口|用途|
|---|---|
|`readPdfDocument(bytes)`|返回 `{ digest, pages }`，即原稿摘要和各页的尺寸、旋转与页码标签。不提取文字|
|`renderPdfPage(bytes, { page, scale, region? })`|把页面或区域渲染为 PNG 字节|
|`printPdf(html)`|把静态 HTML 打印为 PDF 字节。打印不执行脚本，也不加载外部资源|
|`@lg/pdf/mupdf`|应用使用的 MuPDF 实例，API 与 MuPDF.js 相同|

前三项从 `@lg/pdf` 导入。

## 阅读与定位

用 `@lg/pdf/mupdf` 提取文字、字体与坐标，用 `renderPdfPage` 渲染页面或区域，再通过 `ws.emitImage` 查看。多栏、表格、扫描页、图注和公式结合图像判断，跨页内容连同邻页读取。没有提取文字时仍需查看原页。

先看整页确认结构，再裁剪小字、图例和表格细节。区域坐标以旋转后的页面左上角为原点，按 `scale=1` 计算。`region.page` 须与请求页一致。

同一程序中复用已读取的原稿字节，用 `try/finally` 释放 MuPDF 的页面、提取结果和文档。

### 整页阅读与文字提取

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from '@lg/pdf/mupdf';
import { renderPdfPage } from '@lg/pdf';
const bytes = new Uint8Array(await readFile('sources/book.pdf'));
const document = new mupdf.PDFDocument(bytes);
let scale;
try {
  const page = document.loadPage(0);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    scale = 1920 / Math.max(x1 - x0, y1 - y0);
    const text = page.toStructuredText('');
    try { await writeFile('work/page-1.json', text.asJSON()); }
    finally { text.destroy(); }
  } finally { page.destroy(); }
} finally { document.destroy(); }
await writeFile('work/page-1.png', renderPdfPage(bytes, { page: 1, scale }));
await ws.emitImage('work/page-1.png');
```

### 裁剪与细节

所选区域保留完整表格行、图例和图注。放大图像不会恢复原稿中缺失的细节。

以下代码假定 `bytes` 是已读取的原稿字节。

```js
import { writeFile } from 'node:fs/promises';
import { renderPdfPage } from '@lg/pdf';
const region = { page: 1, x: 40, y: 80, width: 400, height: 240 };
const maxEdge = 3840;
await writeFile('work/detail.png', renderPdfPage(bytes, {
  page: region.page,
  region,
  scale: maxEdge / Math.max(region.width, region.height),
}));
await ws.emitImage('work/detail.png', { maxEdge });
```

整页概览使用默认尺寸。密集小字优先裁剪，仍需细节时使用 `ws.emitImage(path, { maxEdge: 3840 })`。按区域尺寸计算渲染比例，渲染与发送使用相同目标最长边。实际尺寸还受字节额度约束，按工具返回的图片尺寸判断有效细节。

### 渲染修改后的文档

内存中修改过的文档先保存为字节再渲染。`asUint8Array()` 只是 Buffer 内存的视图，先复制再释放 Buffer。

```js
import { writeFile } from 'node:fs/promises';
import { renderPdfPage } from '@lg/pdf';
// document 是脚本用 mupdf 打开并修改过的文档，由调用者释放。
const buffer = document.saveToBuffer();
let edited;
try { edited = buffer.asUint8Array().slice(); }
finally { buffer.destroy(); }
await writeFile('work/edited.pdf', edited);
await writeFile('work/edited-1.png', renderPdfPage(edited, { page: 1, scale: 2 }));
await ws.emitImage('work/edited-1.png');
```

需要拼接多个区域，或在图片上标注、绘制中文时，读取 `references/image-tools.md`。

亮度、伽马或颜色调整只用于辅助观察，数值、图例和颜色语义仍与原图核对。

## 准备完整译稿

处置和字段的含义见 `translation` 的「页面模型」。`translate` 处置写作 `{ kind: "translate", markdown, background? }`：

- `markdown`：本页的译稿，可以为空。
- `background`：可选的背景区域。

两个字段的写法见「Markdown 与资源」。

译稿采用所属原页的可见尺寸。相邻正文译稿的尺寸和背景相同时连续排版，变化时开始新页。保留和省略页面会结束连续排版。全部为空译稿或省略时，整份预览返回无输出页，导出正常完成并省略该文件。

### Markdown 与资源

每个原页的 Markdown 独立校验、编译，支持标题、强调、列表、引用、代码、GFM 表格列对齐、提示块、公式和编号注释。

- 图片使用 `![译文图注](pdf-image:DIGEST/PAGE/X,Y,WIDTH,HEIGHT)`。`DIGEST` 为当前原稿摘要，区域位于对应原页。地图、图表和公式截图保留必要的标记、比例尺及图例。图内待译文字另行核对并补充对应译文。
- `background: { page, x, y, width, height }` 引用本原稿的干净装饰区域，按比例覆盖译稿生成页且不占正文空间。先看图确认范围，背景中的文字和图形都会进入生成页。
- 行内公式用 `$...$`，独立公式用单独成行的 `$$` 包围块，货币美元符号用 `\$`。公式错误按返回位置修正，确需截图时使用清晰原稿区域。
- 提示块使用 `> [!NOTE]`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`。注释以 `[^id]` 和 `[^id]: 内容` 表达，引用与定义放在同一原页译稿，输出在该页译稿末尾并提供回链。
- 链接支持 HTTP(S)、`mailto:` 和按当前原页译稿标题顺序编号的页内锚点 `#heading-1`、`#heading-2`。HTML 标签与注释按字面显示，换行使用 Markdown 语法。字体、样式及资源加载由应用控制。
- `work/` 中编辑后的图片用于分析和检查，正式译稿的图片引用只接受原稿身份与区域。

## 预览与核验

使用本包脚本生成预览，再重新打开返回的 PDF 并查看实际输出。`base_url` 取自本技能的 `read_skill` 返回值或显式注入，是原包根目录地址。

```js
import { readFile, writeFile } from 'node:fs/promises';
import { readPdfDocument, renderPdfPage } from '@lg/pdf';
const { preview } = await import(new URL('scripts/preview.mjs', base_url).href);
const result = await preview('book.pdf', 'work/page-updates.jsonl');
if (result.path === null) throw new Error(result.message);
const output = new Uint8Array(await readFile(result.path));
const { pages } = readPdfDocument(output); // 输出页尺寸，坐标与渲染一致
console.log({ output_pages: pages.length });
const output_page = 1; // 按工具图片额度分批查看输出页
const { width, height } = pages[output_page - 1];
const image_path = `work/preview-${output_page}.png`;
await writeFile(image_path, renderPdfPage(output, {
  page: output_page,
  scale: 1920 / Math.max(width, height),
}));
await ws.emitImage(image_path);
```

第二个参数是完整页面更新的 JSONL 草稿，格式见 `ws.contract.changes.pages.updates.reference`。预览与正式提交、导出使用相同的页面判定和生成规则。记录被拒绝时脚本抛出错误，先按行号修复草稿。省略第二个参数时预览当前工程快照。

生成成功后，通过渲染结果核对阅读顺序和实际版式：

|观察到的问题|处理动作|
|---|---|
|方框、缺字或公式异常|核对字符与公式源文，检查修正后的渲染。字体或排版能力受限时记录具体位置|
|表格过宽、单元格裁切|保持数据对应关系，按语义拆分表格并补必要表头，重新检查分页|
|图像标注读不清或裁剪缺项|放大对应区域，确认完整保留图例、单位、标记和图注|
|标题孤悬或图注与图像分离|调整相关 Markdown 内容组织，再查看输出衔接|
|背景文字叠印或遮挡|重新选择干净区域或移除背景，查看实际生成页|
|跨页遗漏、重复或顺序错误|核对来源与接管页面，修正涉及的完整载荷并预览连续排版段|

修正后复查受影响输出。译稿长度、尺寸或背景变化可能改变后续分页，此时按原页身份、标题或内容片段重新定位相关连续排版段及其与保留原页的衔接。旧输出页码仅作为历史记录。

图片请求或宿主失败时保留材料，说明未完成的核验。

预览使用读取时的快照，正式提交重新判定当前工程事实。单页变化不影响邻页指纹，原稿摘要变化会使该文件的旧指纹失效，此时重读快照并更新变更清单。

## 翻译后检查

翻译流程提交译稿后，用「预览与核验」的脚本预览当前工程快照。

- 预览失败或记录被拒绝时，按返回的行号和位置修正译稿，重新提交，再次预览，直到预览成功。
- 记录输出页数量，供交付使用。

逐页查看渲染结果属于审校，翻译流程不执行。

## 交付说明

预览 PDF 用于内部排版检查，默认不在回复中提供其文件或所在目录的下载链接。用户明确要求查看或下载预览时，提供标为“排版预览”的链接，并说明它基于工程现值还是未提交草稿。正式 PDF 按 `project-operation` 的「生成与交付」生成。
