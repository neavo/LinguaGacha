---
name: pdf
description: 翻译、审校、分析、修改 PDF 文件（含 `.generic` 通用包）前必须加载。
---

内置解析器不识别 PDF，原稿经 `generic-package` 封装为 `.generic` 资产进入工程。处理 PDF 通用包时同时加载 `generic-package`。

阶段例外：PDF 翻译须结合原页版面、图表与图像判断，在当前对话中按每组约 `5` 页逐组翻译（走 `translation` 的当前对话分支，不调用 `batch_item_translation`）。

# 来源调查

按材料形态确定处理入口：

|材料形态|识别特征|处理入口|
|---|---|---|
|原始 `.pdf` 文件|上传目录或本机 `.pdf` 文件，不属于内置解析器范围|按「导入准备」提取页面并封包为 `.generic`|
|正式 PDF 通用包|`.generic` 资产，展开目录含 `source.pdf`、`pdf.json`、`writeback.mjs` 与非空 `items.json`|按当前契约直接翻译、审校、修改或写回|
|旧版静态迁移包|`.generic` 资产，展开目录含 `legacy-pdf.json` 且 `items.json` 为空数组 `[]`|先读取 [旧版 PDF 迁移指南](references/migration.md) 完成转换与旧译稿回填|

准备依赖后，调用 `pdf.inspect(source)` 读取原稿摘要（`digest`）、页数、各页尺寸、旋转、页码标签和内嵌文字；内嵌文字稀疏或疑似扫描页时，用 `pdf.renderPage` 抽样查看代表页。

# 导入准备

## 环境与依赖

PDF 脚本入口从本技能 `read_skill` 返回的 `base_url` 动态导入。任何阶段首次使用前，先调用 `missingDependencies()` 检查共享 npm 环境的依赖缺口：

```js
import { npm } from '@lg/npm';
const pdf = await import(new URL('scripts/pdf.mjs', base_url).href);
const missing = pdf.missingDependencies();
if (missing.length) {
  await npm.run(['install', '--save-exact', ...missing]);
}
```

- 存在缺口时，先告知用户「首次处理 PDF 需要下载约 15–20 MB 的 npm 依赖，后续跨工程复用」，再执行安装。
- 安装完成后，在**下一次** `workspace_run` 调用中再运行依赖 `mupdf` 的脚本（同一次调用内无法加载刚安装的包）。
- `@lg/pdf` 只导出 `printPdf(html)`，由应用宿主打印静态 HTML 为 PDF 字节（不执行脚本、不加载外部资源）；需要底层 MuPDF 对象时直接 `import * as mupdf from 'mupdf'`。

## 准备与封包

调用 `pdf.prepareAndPack(source, output)` 读取一次原稿，冻结 `source.pdf`，为每页生成记录并封装为 `.generic` 包（内置 `source.pdf`、`items.json`、`pdf.json`、`README.md` 及写回脚本）：

```js
const pdf = await import(new URL('scripts/pdf.mjs', base_url).href);
const packed = await pdf.prepareAndPack('uploads/book.pdf', 'work/book.pdf.generic');
console.log(packed); // { output_path, pages, digest, ... }
```

- 普通有内嵌文字且页内唯一的页直接保存提取文本。仅两类页会自动补系统标识（用于区分跨页空译稿，并防止后端按原文去重克隆译稿或替换继承冲突）：
  - 无内嵌文字页：`[PAGE N - NO TEXT]`（扫描页需补充参考原文时，结合原页图像或 OCR 替换正文，保持数组次序且避免与同文档其他页正文完全相同）
  - 同文档内正文完全重复的页：`[PAGE N - DUPLICATED PAGE]\n<提取文本>`
- 封包后将 `packed.output_path` 交回 `project-operation` 识别与提交。
- 更换底稿 PDF 时必须重新封包并按「更新文件」提交；底稿摘要变化会使旧的 `pdf-image:DIGEST/...` 引用失效。

# 原稿与条目

## 条目结构与处置

正式 PDF 通用包在 `sources/<file_path>/` 展开，底稿位于 `sources/<file_path>/source.pdf`，文档摘要位于 `pdf.json` 的 `digest`。`items.json` 按原稿页序每页占 1 条（`row_number === page - 1`；`page` 为 1 基原稿页码，MuPDF 页索引为 0 基）。

- 源记录中出现的 `[PAGE N - NO TEXT]`、`[PAGE N - DUPLICATED PAGE]` 均为防冲突占位标识，**译稿 `dst` 只写实际 Markdown 正文，不翻译也不复制这类标识**。
- 原稿页与输出页独立：内容归属与覆盖统计按原稿页追踪；排版问题按输出页定位，输出页数与页码会随译稿排版变化。

页面四态处置与写回规则：

|业务处置|工程条目与包内记录方式|写回行为|
|---|---|---|
|输出译稿|`status: "PROCESSED"`，`dst` 写本页完整最终 Markdown|按原页可见尺寸排版打印；同尺寸、同背景的相邻译稿连续排版，变化时新起一页|
|跨页接管（被合并页）|`status: "PROCESSED"`，`dst: ""`（空字符串）|跳过打印，前后同尺寸、同背景的译稿继续连续排版|
|保留原页|`status: "EXCLUDED"`（保留原文）；未处理的 `NONE` 条目同样沿用原页|原页矢量无损直通，结束连续排版|
|省略原页|修改包内 `items.json` 该页 `omit: true` 并重打包替换，同时条目设为 `EXCLUDED`|不输出该页，结束连续排版|

- **跨页内容归属**：跨页段落、表格或图注可整体归入其中一页，其余被接管页提交 `dst: ""` 与 `status: "PROCESSED"`；调整跨页归属时同批提交全部受影响条目，确保无遗漏、无重复。
- **修改包内私有配置**：调整 `omit`、`background` 或 `notes` 时，将 `sources/<file_path>/` 复制到 `work/` 新目录修改 `items.json`（保持 `message` 与数组顺序不变），调用 `@lg/generic` 的 `pack()` 重打包，再按 `project-operation` 的 `files.replaces`（`inheritance_mode: "inherit"`）就地替换，已有译文自动继承。

## 分组与视觉翻译

- 按原稿页序分组，每组约 `5` 页，跨页段落、表格与图注涉及的页保持在同一业务单元。
- 多栏、表格、扫描页、图注、公式或无内嵌文字的页面，必须渲染原页并通过 `ws.emitImage` 查看确认，跨页内容连同邻页查看。
- 每页译稿须覆盖正文、标题、列表、表格、数字、单位、图注、注释和引用；确认无需翻译的页设为 `EXCLUDED`，缺少决定性事实时保持 `NONE` 并记为未决。

## 阅读原页与裁剪

用 `pdf.renderPage(source, { page, scale, region? })` 渲染整页或区域，再用 `ws.emitImage` 查看。区域坐标以旋转后页面左上角为原点，按 `scale = 1` 计量，`region.page` 须与 `page` 一致。

```js
import { writeFile } from 'node:fs/promises';
const pdf = await import(new URL('scripts/pdf.mjs', base_url).href);
const source = 'sources/book.pdf.generic/source.pdf';

// 整页概览
const info = await pdf.inspect(source);
const page1 = info.pages[0];
await writeFile(
  'work/page-1.png',
  await pdf.renderPage(source, { page: 1, scale: 1920 / Math.max(page1.width, page1.height) }),
);
await ws.emitImage('work/page-1.png');

// 局部裁剪（保留完整表格行、图例和图注）
const region = { page: 1, x: 40, y: 80, width: 400, height: 240 };
const maxEdge = 3840;
await writeFile(
  'work/detail.png',
  await pdf.renderPage(source, {
    page: region.page,
    region,
    scale: maxEdge / Math.max(region.width, region.height),
  }),
);
await ws.emitImage('work/detail.png', { maxEdge });
```

- 整页概览用默认看图尺寸；密集小字优先裁剪，再按相同 `maxEdge` 渲染与发送（按工具实际返回尺寸判断有效细节，放大不恢复原稿缺失细节）。
- 需要提取字体、坐标等底层结构时，直接 `import * as mupdf from 'mupdf'`，同一脚本内复用原稿字节，并用 `try/finally` 释放 `page`、结构化文本与 `document`。
- 需要拼接多个区域或在图片上标注中文时，读取 [区域拼接与标注](references/image-tools.md)。

## Markdown 译稿与资源

每个原页的 Markdown 独立编译，支持标题、强调、列表、引用、代码、GFM 表格列对齐、提示块、KaTeX 公式与编号注释：

- **原稿嵌图**：写作 `![译文图注](pdf-image:DIGEST/PAGE/X,Y,WIDTH,HEIGHT)`。`DIGEST` 必须与包内 `pdf.json` 的 `digest` 一致，区域位于对应原页边界内。地图、图表与公式截图保留必要标记、比例尺及图例，图内待译文字另行补充译文。`work/` 中编辑的图片只用于分析，正式译稿仅接受原稿区域引用。
- **页面背景**：包内记录的 `background: { page, x, y, width, height }` 引用本原稿干净装饰区域，按比例覆盖译稿生成页且不占正文空间。设置前先看图确认范围，避免残留文字叠印正文。
- **公式**：行内公式用 `$...$`，独立公式用单独成行的 `$$` 块，货币美元符号写作 `\$`。公式编译报错时按提示位置修正，确需截图时使用清晰原稿区域。
- **提示块与注释**：提示块支持 `> [!NOTE]`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION`。注释用 `[^id]` 与 `[^id]: 内容`，引用与定义放在同一原页译稿内，输出在该页译稿末尾并提供回链。
- **链接与标签**：链接支持 `http(s)://`、`mailto:` 与按当前原页标题顺序编号的页内锚点 `#heading-1`、`#heading-2`。HTML 标签与注释按字面显示，换行使用 Markdown 语法。

# 翻译后检查

翻译或审校提交译稿后，调用 `generateFiles()` 并执行源包自带的 `writeback.mjs` 完成一次完整写回（见「写回 PDF」）：

- 写回报错时，按返回的页号与位置修正对应条目，重新提交并再次写回，直到成功。
- 记录最终生成的输出页数量，供交付汇报使用。
- 仅翻译流程只核验写回成功与输出页数，不逐页查看渲染图；审校或交付验证时再按「视觉复核与常见问题」看图检查。

# 写回与验证

## 写回 PDF

预览检查与正式交付共用源包自带的 `writeback.mjs`，输入来自本次 `generateFiles()` 返回的 `<writeback.input_path>/<file_path>/items.json`：

```js
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateFiles } from '@lg/project';
const pdf = await import(new URL('scripts/pdf.mjs', base_url).href);

const generated = await generateFiles();
const asset = 'book.pdf.generic';
const directory = path.join('sources', asset);
const output = 'work/preview/book.pdf';
await mkdir(path.dirname(output), { recursive: true });

const { build } = await import(pathToFileURL(path.resolve(directory, 'writeback.mjs')).href);
const result = await build({
  directory,
  itemsPath: path.join(generated.writeback.input_path, asset, 'items.json'),
  output,
});
if (result.path === null) {
  console.log({ output_path: null, output_pages: 0 });
} else {
  const info = await pdf.inspect(result.path);
  console.log({ output_path: result.path, output_pages: info.pages.length });
  const page = info.pages[0];
  await writeFile(
    'work/preview/page-1.png',
    await pdf.renderPage(result.path, {
      page: 1,
      scale: 1920 / Math.max(page.width, page.height),
    }),
  );
  await ws.emitImage('work/preview/page-1.png');
}
```

- `output` 所在目录须先创建，文件本身须尚未存在（防止覆盖既有产物）。
- 写回按位置核对原稿页码并使用封包时的 `digest` 解析嵌图；整份所有页均省略或为空译稿时返回 `{ path: null }`。
- 正式交付的文件名去掉资产路径末尾的 `.generic`（或按 `pdf.json` 的 `original_file_name` 确认），再按 `project-operation` 的「导出与交付」复制到交付目录。

## 视觉复核与常见问题

审校、排版微调或最终交付核验时，按工具图片额度分批渲染输出页并结合 `ws.emitImage` 核对阅读顺序与版式：

|观察到的问题|处理动作|
|---|---|
|方框、缺字或公式异常|核对字符与公式源文，修正后复查渲染；字体或排版受限时记录具体位置|
|表格过宽或单元格裁切|保持数据对应关系，按语义拆分表格并补全表头，重新检查分页|
|图像标注不清或裁剪缺项|放大原页核对，重新选取包含完整图例、单位、标记和图注的区域|
|标题孤悬或图注与图像分离|调整相关 Markdown 内容组织，重新查看输出衔接|
|背景文字叠印或遮挡正文|重选干净背景区域或移除 `background`，重打包替换后复查|
|跨页遗漏、重复或错序|核对来源与被接管条目，同批修正全部受影响条目并复查连续排版段|

译稿长度、尺寸或背景变化会改变后续输出分页。修正后按原页身份、标题或内容片段重新定位受影响的连续排版段及其与保留原页的衔接，不沿用旧输出页码。看图或打印宿主失败时保留工作材料，如实说明未完成的核验范围。

# 交付说明

- **仅单语交付**：PDF 仅交付单语成果；用户明确要求双语对照 PDF 时，须在译稿排版阶段将原文与译文编排进同一份译稿。
- **预览边界**：内部排版检查生成的预览 PDF 默认不在回复中提供下载链接；用户明确要求查看或下载预览时提供链接，并标明“排版预览”。
- **汇报要点**：正式 PDF 按 `project-operation` 的「导出与交付」生成并交付，汇报时说明：
  - 交付路径、原稿页数、输出页数，以及各处置统计（译稿、空译稿接管、保留原页、省略原页、未决）
  - 视觉复核覆盖范围与修复的排版问题
  - 剩余限制或未决事项（例如未看图核验范围、缺字位置或整份无输出页）
