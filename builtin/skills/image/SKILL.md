---
name: image
description: 导入、分析、翻译、审校、修改或导出独立图片、漫画、插画及 `.image` 资产前必须加载。
---

# 图片与漫画处理

`@lg/image` 负责检测文字框、笔画抹除、排版、预览与发布。`.image` 保存原图和确认后的区域，工程 `items` 独占译文 `dst` 和完成状态 `status`。

## 环境与来源

- 接收静态、不透明的 PNG 或 JPEG，单页不超过 `100_000_000` 像素。游戏目录里的贴图先按对应引擎技能判定归属。
- 按自然页序组织 `sources`，每本书使用独立 `workDirectory`，例如 `work/image/book/`。零文字页保留，`regions` 可为空。
- 用 `@lg/npm` 安装 `onnxruntime-node@${INFERENCE_DEPENDENCIES.ort}`，传 `--save-exact`。用 `@lg/uv` 添加 `numpy==${INFERENCE_DEPENDENCIES.numpy}` 与 `opencv-python-headless==${INFERENCE_DEPENDENCIES.opencv}`。声明已存在但环境缺失时运行 `uv.run(['sync', '--inexact'])`。
- 从 `@lg/image` 导入 `INFERENCE_DEPENDENCIES` 和 `prepare_models`，先执行 `await prepare_models()`。当前设备基线使用 `device: 'cpu'`。

## 1. 检测并确认原文

```js
import * as image from '@lg/image';
const prepared = await image.prepare({ sources, workDirectory, device: 'cpu' });
for (const page of prepared.candidates) await ws.emitImage(page.result.preview);
const draft = await image.read(workDirectory);
```

`prepare` 写入预填 `regions` 与原文为空的 `records`，并返回带相同区域编号的预览。`previewScale` 表示预览与原图的缩放比例。所有 `bbox` 使用原图坐标，不要从缩略图重新猜框。

逐页核对编号、漏字、阅读顺序和原文。同一文字块出现重复或重叠候选框时合并为一个区域，并同步删除 `records` 中多余的记录。检测器可能在旧报纸或英文长文页返回零候选，仍须看图补框，不能据此判定为零文字页。检测顺序只是初稿，按作品实际分镜调整 `records`，其页序与 `pages` 一致。低置信度、手写字或网点遮挡需要原寸裁图复核，看不清时报告具体缺口。

每个区域只有以下配置：

- `regionId`：页内唯一且稳定。调整框或样式保留 ID，拆分或合并文字时生成新 ID。
- `disposition`：`translate` 或 `preserve`。每个待译区域须对应一条 `{ pageId, regionId, message, name? }` 原文记录。已有词条改为 `preserve` 时保留记录，避免重建工程条目。
- `bbox: { x, y, width, height }`：原图内的整数矩形，包含完整文字笔画，尽量避开画线与邻近文字。检测漏字时补框和原文记录。
- `direction`：`vertical-rl` 或 `horizontal-tb`。
- 可选 `style`：默认由程序采样颜色和参考字号。复核需要时调整 `color`、`stroke`、`strokeWidth`、`weight`、`rotation`、`minFontSize`、`fontSize`、`align`。`fontSize` 是排版字号上限，`align: 'start'` 适合左对齐长段落，默认居中。

确认全部原文与区域后提交：

```js
await image.apply(workDirectory, draft.revision, {
  pages: draft.book.pages,
  records: draft.records,
  confirmed: true,
});
const archive = await image.pack(workDirectory, 'work/book.image');
```

按 `project-operation` 用 `changes/files/creates.jsonl` 导入 `archive.path`。原文、页序、词条身份或数量变化时，重新打包并用 `changes/files/replaces.jsonl` 和 `inheritance_mode: 'inherit'` 更新工程，核对继承回执。

## 2. 翻译工程词条

结合原图语境直接翻译 `IMAGE` 条目，不使用纯文本 `batch_item_translation`。可以在看图确认时拟译，先导入资产，再按 `project-operation` 提交 `changes/items/updates.jsonl`。译文与完成状态只写入工程。

已有资产通过 `await image.restore('sources/' + file_path, workDirectory)` 恢复草稿与原图。`restore` 会覆盖本地版面调整，仅在需要重新同步工程原稿时使用。

## 3. 执行与视觉复核

提交译文后，调用 `@lg/project` 的 `generateFiles([])`。取 `path.join(writeback.input_path, file_path)` 为 `writebackDirectory`，不要手工构造完成清单。

```js
const execution = await image.execute({ workDirectory, writebackDirectory, device: 'cpu' });
for (const page of execution.pages) {
  await ws.emitImage(page.preview);
  console.log(page.pageId, page.regions);
}
```

程序按文字笔画提取掩码，均匀背景直接填色，复杂背景用 LaMa 修复。区域独立回退，失败区域保留原图。`ready` 仅表示程序检查通过，仍需逐页检查残字、画线损伤、漏译、字号与换行。

- `incomplete_text`：提交对应工程条目的译文与 `PROCESSED` 状态，再生成写回快照。
- `needs_layout` / `text_collision`：调整译文或框与样式。
- `empty_capture`：文字截图未产生可见像素。重试仍失败时保留原图。
- `no_text_strokes`：框内未提取出文字笔画，核对框的位置。
- `preserve`：该区域明确保留原图。

只改 `bbox`、`direction`、`style` 或 `disposition`，保留原有 `records`，直接 `apply` 后复用现有 `writebackDirectory` 再次 `execute`。修改译文需要重新 `generateFiles([])`。修改原文或词条集合需要重新打包替换资产后生成快照。

初轮之后最多两轮人工纠偏。效果仍不可靠时，将对应区域改为 `disposition: 'preserve'` 后重新执行并复核。

## 4. 发布与交付

逐页完成视觉与语义复核后，按 `project-operation` 的 `getOutputPaths` 确定交付父目录：

```js
const delivered = await image.publish({
  workDirectory,
  executionId: execution.executionId,
  outputDirectory,
});
console.log(delivered.path);
```

`publish` 采纳就绪区域并保留失败区域。同一执行可重试，期间修改草稿或写回快照需重新执行和复核。

交付目录包含按页序命名的 PNG 与 `delivery.json`。汇报页数、目录、`complete` 或 `partial` 状态，列出保留原图的待译区域及原因。以返回的 `path` 提供目录链接。
