---
name: image
description: 翻译、审校、分析、修改图片或漫画文件，或制作、更新、写回 `.image` 资产时使用。
---

本技能处理有框与无框文字。目标是完整登记原文，生成可恢复的无字底图，并只交付经过视觉验收的译图。

阶段导航：

|阶段入口|本技能内容|
|---|---|
|来源调查|确认图片归属、页面集合和阅读顺序|
|导入准备|准备环境，确认区域，消字并封装 `.image`|
|原稿与条目|理解归档事实、区域状态和原文顺序|
|可见文本补漏|核对检测覆盖，有遗漏时重做 `.image`|
|翻译后检查|核对译文快照的完成状态|
|写回与验证|自动排版、整页视觉验收和发布|
|交付说明|报告完整、部分和保留内容|

# 来源调查

- 独立图片、扫描页和漫画按自然阅读顺序组成处理批次。同一话或同一连续阅读单元通常封装为一个 `.image`。无关图片分开。
- 游戏目录中的图片先由对应引擎技能判断是否属于游戏资源。需要作为独立图片资产处理时，再交给本技能。
- 核对页数、方向、分辨率与重复页。顺序或归属不明确时先解决，不凭文件名强行排序。
- 只需查看或分析时读取原图即可，不制作 `.image`。需要进入工程或交付译图时进入「导入准备」。

# 导入准备

## 环境准备

图片 SDK 只声明依赖，不自动安装。首次使用或依赖缺失时准备共享环境和模型：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
import * as image from '@lg/image';

await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
if (image.missing_models().length > 0) await image.prepare_models();
```

依赖版本以 `IMAGE_DEPENDENCIES` 为准，不自行升级。模型准备失败时保留工作材料并报告实际缺口。不伪造检测结果继续封包。

## 区域与原文确认

调用 `prepare`。已有工作目录改用 `read`：

```js
const prepared = await image.prepare({
  sources,
  workDirectory: 'work/image/ch01',
  device: 'cpu',
});
```

逐页查看完整原页、`evidence[].preview`、`fillPreview` 和必要裁图。Agent 判断：

- 哪些 `textBoxIds` 属于同一段文字。
- 区域是 `bubble` 还是 `unframed`。
- 文字应翻译、保留、标为无法识读，还是记录为修复失败。
- 原文、可选说话人、阅读顺序和书写方向。
- 检测框是否确实不是文字。

气泡区域复用 `prepare` 生成的 `layoutArea`。新建无框区域时填写 `textBoxIds` 并令 `layoutArea: null`，`apply` 会在事务中生成排版区域和背景分析。不要写掩码文件或伪造路径。

每个检测文字框必须恰好属于一个区域，或明确列入该页 `falsePositiveTextBoxIds`。应翻译的文字不能标成误检。已知漏检且无法形成合法区域时，用无文字框的 `preserve + repair_failed` 区域记录缺口。

提交完整页面与原文记录：

```js
const applied = await image.apply(workDirectory, current.revision, {
  pages,
  records,
  confirmed: true,
});
```

确认失败时按错误修正归属、字段或原文。不要降低覆盖要求。

## 消字与封装

调用 `erase`。它生成候选，不修改已验收底图：

```js
const erased = await image.erase({
  workDirectory,
  expectedRevision: applied.revision,
});
for (const page of erased.pages)
  for (const material of page.materials)
    await ws.emitImage(material, { maxEdge: 1600 });
```

结合完整原页和候选拼图，为每个待译区域选择候选编号、`preserve` 或 `failed`。页面决定必须覆盖该页返回的全部区域：

```js
const reviewed = await image.review({
  workDirectory,
  runId: erased.runId,
  expectedRevision: erased.revision,
  pages: [{
    pageId,
    regions: [
      { regionId: 'r0001', value: 'A' },
      { regionId: 'u0001', value: 'failed' },
    ],
  }],
});
```

- 合格候选继续进入翻译与写字。
- `preserve` 提交为 `intentional`。
- `failed` 提交为 `repair_failed`，归档状态成为 `partial`。
- 未知候选、遗漏区域或过期运行会拒绝整次提交。

提交后封装并核对状态：

```js
const packed = await image.pack(workDirectory, 'work/image/ch01.image');
```

把 `.image` 交回 `project-operation` 识别、提交并完成导入收尾。

# 原稿与条目

`.image` 的持久事实：

|路径或字段|含义|
|---|---|
|`image.json`|页身份、检测文字框、语义区域与 `layoutArea`|
|`items.json`|按阅读顺序排列的原文与可选说话人|
|`clean.json`|已验收底图、实际 `eraseMask` 与 `complete | partial` 状态|
|`layout-areas/<pageId>/<regionId>.png`|译文允许出现的区域|
|`erase-masks/<pageId>/<regionId>.png`|候选实际改变的像素|

`textBoxes` 中的 `box` 用于归属和消字，`coreBox` 用于原文字号锚定。`translate` 区域进入工程条目。`preserve` 区域只保留原因。`text: null` 表示尚未翻译，空字符串表示明确不写文字。

原文、姓名、阅读顺序或方向变化不要求重新消字。区域、`layoutArea`、处置或实际原图变化会使对应底图验收失效。

# 可见文本补漏

持久化文字框提供机械覆盖门禁，不能证明检测器绝无漏检。处理图片补漏时查看完整原页，并把可见文字与 `textBoxes`、区域和原文记录对应：

- 漏掉的气泡、无框文字、界面文字或旁白必须补入区域。
- 装饰文字只有在不影响理解且确实有意保留时使用 `intentional`。
- 无法识读使用 `unreadable`。应处理但当前无法形成合法区域使用 `repair_failed`。
- 发现遗漏、误分组、误检或消字范围错误时，恢复或重做完整 `.image`，按 `project-operation` 的「更新文件」替换资产并继承可复用译文。不在工程译文中用空字符串掩盖区域问题。

# 翻译后检查

核对当前 `.image` 写回快照：

- 每个 `translate` 区域的译文状态符合本次任务范围。
- 空字符串确实表示有意不写文字，不是漏译。
- `repair_failed`、`unreadable` 和 `intentional` 仍符合原页事实。
- 原文、方向或区域在翻译期间发生变化时，先更新 `.image`，再继续写回。

整页排版和视觉验收属于「写回与验证」，只有导出或交付图片成果时执行。

# 写回与验证

`project-operation` 调用 `generateFiles` 后，使用已展开的 `.image` 原稿和对应写回输入：

```js
const draft = await image.restore('sources/ch01.image', 'work/image/ch01');
const rendered = await image.render({
  workDirectory: 'work/image/ch01',
  inputPath: `${writeback.input_path}/ch01.image/items.json`,
  expectedRevision: draft.revision,
});
for (const page of rendered.pages)
  if (page.preview) await ws.emitImage(page.preview, { maxEdge: 1600 });
```

程序根据原文几何、译文和 `layoutArea` 自动生成排版，并验证文字完整、字形、边距、重叠和像素范围。Agent 查看最终整页，核对：

- 是否仍有原文或漏译。
- 译文与区域是否对应。
- 阅读顺序、方向、断行和字号是否自然。
- 文字是否遮挡人物或重要画面。

`rendered` 表示机械门禁通过，仍需形成页面决定。只有 `rendered` 页面可以接受。拒绝时填写具体视觉原因：

```js
const delivery = await image.publish({
  workDirectory: 'work/image/ch01',
  outputDirectory: 'work/image/ch01-delivery',
  expectedRevision: draft.revision,
  source: {
    kind: 'rendered',
    renderId: rendered.renderId,
    decisions: [
      { pageId: 'p1', decision: 'accept' },
      { pageId: 'p2', decision: 'reject', reason: 'r0003 断行影响阅读' },
    ],
  },
});
```

未译、缺字、`no_fit`、修复失败和视觉拒绝进入 `incomplete/`：

- 译文过长或表达不自然：修订工程译文后重新生成写回输入。
- 区域、方向、原文或消字错误：回到 `.image` 的导入准备与更新流程。
- 自动排版本身不合格：拒绝页面并报告区域和现象，不在工作材料中伪造逐页排版参数。

把发布目录中核对过的页面作为该资产的写回成果，写回输入、拒绝页和诊断材料不作为完整成品交付。

# 交付说明

对照 `delivery.json`、`clean.json` 与 `image.json` 汇报：

- `.image`、成品目录与 `complete | partial` 状态。
- `repair_failed`、`unreadable`、未译、`no_fit`、缺字和视觉拒绝的页与区域。
- `intentional` 保留文字和确认为误检的检测框。
- 小字号但已视觉确认可读的区域。

`complete` 只表示文字覆盖完整、底图完整且所有待译页均已视觉接受。
