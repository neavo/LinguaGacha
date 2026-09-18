---
name: pdf
description: 涉及 PDF 阅读、文字与图像提取、页面定位、译稿保存、排版或预览时使用。
---

# PDF 处理能力

## 确认原稿与范围

通过 `ws.contract.datasets.pages.path` 读取 `pages`，身份与字段以对应 `reference` 为准。`project_meta.files[].source_binary_path` 提供原稿路径。`page` 是从 1 开始的原稿页码，MuPDF 的页索引从 0 开始。翻译和审校的覆盖、提交及完成要求使用 `translation` 中对应的 `pages` 流程。

先确定目标原页、已有处置和 `notes`。内容归属按原页身份追踪，视觉问题按生成后的输出页定位，输出页数和页码可以随排版变化。

## 阅读与定位

用 `mupdf` 提取文字、字体与坐标，用 `@lg/pdf` 的 `render_pdf_page` 渲染页面或区域，再通过 `ws.emitImage` 查看。多栏、表格、扫描页、图注和公式结合图像判断，跨页内容连同邻页读取。没有提取文字时仍需查看原页。

先看整页确认结构，再裁剪小字、图例和表格细节。区域坐标以旋转后的页面左上角为原点，按 `scale=1` 计算，`region.page` 须与请求页一致。按区域尺寸选择渲染比例，输出默认使用 PNG。

```js
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
import { render_pdf_page } from '@lg/pdf';
const meta = JSON.parse(await readFile(ws.contract.datasets.project_meta.path, 'utf8'));
const source = meta.files.find(file => file.file_path === 'book.pdf');
if (!source?.source_binary_path) throw new Error('PDF source not found');
const document = new mupdf.PDFDocument(new Uint8Array(await readFile(source.source_binary_path)));
try {
  const page = document.loadPage(0);
  let scale;
  try {
    const bounds = page.getBounds();
    scale = 1920 / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    const text = page.toStructuredText('');
    try { await writeFile('work/page-1.json', text.asJSON()); }
    finally { text.destroy(); }
  } finally { page.destroy(); }
  await writeFile('work/page-1.png', render_pdf_page(document, { page: 1, scale }));
  await ws.emitImage('work/page-1.png');
} finally { document.destroy(); }
```

将示例文件名和页码替换为当前目标。在同一程序中复用文档，并用 `try/finally` 释放逐页资源、提取结果和文档。

密集细节在裁剪后仍需更高分辨率时，使用 `ws.emitImage(path, { maxEdge: 3840 })`，渲染与发送采用同一目标最长边。实际尺寸还受字节额度约束，按工具返回的图片尺寸判断有效细节。裁剪、拼接、区域标注或中文图层需要具体代码时，读取 `references/images.md`。

## 准备完整译稿

每页保存完整的 `translation`、`reviewed` 和 `notes`，局部修改也准备完整页面载荷。

|`translation` 值|页面处置|
|---|---|
|`null`|待处理，导出暂用原页。恢复此值会清除完成处置|
|`{ kind: "translate", markdown, background? }`|输出归属该页的译稿，`markdown` 可以为空|
|`{ kind: "keep", reason }`|确认保留原页，`reason` 记录依据|
|`{ kind: "omit", reason }`|按用户要求省略原页，`reason` 记录原因|

译稿覆盖、确认保留和省略均计入完成。`reviewed` 记录内容核对，`notes` 保存待办与续做说明，两者不决定完成率。视觉检查记录包含实际查看的输出范围和未决问题。

跨页内容可以完整归入其中一页，其余已接管页面使用空译稿，并在相关 `notes` 中记录来源与去向。排版跳过空译稿，直接衔接前后译稿。

译稿采用所属原页的可见尺寸。相邻正文译稿的尺寸和背景相同时连续排版，变化时开始新页。保留和省略页面会结束连续排版。保存可暂时全部为空译稿或省略，预览与导出至少需要一张输出页。

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
import * as mupdf from 'mupdf';
import { render_pdf_page } from '@lg/pdf';
const { preview } = await import(new URL('scripts/preview.mjs', base_url).href);
const result = await preview('book.pdf', 'work/page-updates.jsonl');
const output = new mupdf.PDFDocument(new Uint8Array(await readFile(result.path)));
try {
  console.log({ output_pages: output.countPages() });
  const output_page = 1; // 替换为本次需要检查的输出页，按工具图片额度分批查看。
  const page = output.loadPage(output_page - 1);
  let scale;
  try {
    const bounds = page.getBounds();
    scale = 1920 / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
  } finally { page.destroy(); }
  const image_path = `work/preview-${output_page}.png`;
  await writeFile(image_path, render_pdf_page(output, { page: output_page, scale }));
  await ws.emitImage(image_path);
} finally { output.destroy(); }
```

第二个参数是完整页面更新的 JSONL 草稿，格式见 `ws.contract.changes.pages.updates.reference`。脚本校验所有记录的结构，再对目标文件复用正式页级判定，覆盖快照副本后调用正式 PDF 生成入口。目标更新被拒绝时，先按行号修复草稿。省略第二个参数时预览当前工程快照。

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

## 提交、恢复与交付

通过 `ws.contract.changes.pages.updates.path` 指定的 JSONL 提交，每个 `page` 在同批提交一次。跨页调整提交涉及的全部 `pages`。逐页回执决定实际接受与拒绝，审批和 `applied.pages.updated` 按实际变化的页面对象数计数。

预览使用读取时的快照，正式提交重新判定当前工程事实。部分成功时结合回执与最新快照恢复一致归属。单页变化不影响邻页指纹，原稿摘要变化会使该文件的旧指纹失效，此时重读快照并更新方案。

`translation`、`reviewed` 和 `notes` 随 `.lg` 保存。`work/` 保存临时材料，对话重置或应用重启后依据工程现值与已保存 `notes` 恢复。

预览 PDF 用于内部排版检查，默认不在回复中提供其文件或所在目录的下载链接。用户明确要求查看或下载预览时，提供标为“排版预览”的链接，并说明它基于工程现值还是未提交草稿。

翻译交付说明实际保存范围、核验结果、未决事项及续做条件。正式 PDF 由用户通过应用导出。
