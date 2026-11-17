---
name: image
description: 翻译、审校、分析、修改图片或漫画文件，或制作、更新、写回 `.image` 资产时使用。
---

本技能处理有框与无框文字。目标是完整登记原文、保留原始相对路径，并生成可恢复的无字底图。译图由文件生成服务自动排版、回退和写出。

阶段导航：

|阶段入口|本技能内容|
|---|---|
|来源调查|确认图片归属、页面集合和阅读顺序|
|导入准备|准备环境，确认区域，消字并封装 `.image`|
|原稿与条目|理解归档事实、区域状态和原文顺序|
|可见文本补漏|核对检测覆盖，有遗漏时重做 `.image`|
|翻译后检查|核对译文快照的完成状态|
|写回与验证|读取自动生成的图片报告|
|交付说明|报告成功、警告、失败和原文回退|

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
  sources: sources.map((source) => ({
    path: source.path,
    relativePath: source.relativePath,
  })),
  workDirectory: 'work/image/ch01',
  device: 'cpu',
});
```

`relativePath` 相对本批图片共同来源根目录，使用 `/`，保持原始目录与文件名。不同页面不能使用大小写不敏感的同一路径。

逐页查看完整原页、`evidence[].preview`、`fillPreview` 和必要裁图。

原图检测框是基础事实。第二次检测只补充气泡清理后显露的文字。

Agent 判断：

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

调用 `erase`。它按“气泡优先、无框随后”的顺序生成唯一自动结果。它不会修改已验收底图。

背景满足填色条件时直接填色，否则使用 LaMa。笔画掩码不可用时自动回退到文字框掩码：

```js
const erased = await image.erase({
  workDirectory,
  expectedRevision: applied.revision,
});
for (const page of erased.pages)
  await ws.emitImage(page.clean, { maxEdge: 1600 });
```

结合完整原页、检测证据和自动底图进行整页质检。页面决定必须覆盖本次运行的全部页面：

```js
const reviewed = await image.review({
  workDirectory,
  runId: erased.runId,
  expectedRevision: erased.revision,
  pages: erased.pages.map(({ pageId }) => ({ pageId, accepted: true })),
});
```

- `accepted: true` 提交该页自动底图。
- `accepted: false` 保留当前事实和已有验收结果。修正区域后重新运行。
- 自动修复失败的区域提交为 `repair_failed`，导出时该区域保留原文并记录失败。
- 未知页面、遗漏页面或过期运行会拒绝整次提交。

提交后封装：

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
|`clean.json`|已验收底图、实际 `eraseMask` 与区域处置|
|`layout-areas/<pageId>/<regionId>.png`|译文允许出现的区域|
|`erase-masks/<pageId>/<regionId>.png`|自动消字实际改变的像素|

`textBoxes` 中的 `box` 用于归属和消字。`coreBox` 用于原文字号锚定。

`translate` 区域进入工程条目。`preserve` 区域只保留原因。

`text: null` 表示工程条目尚未完成。空字符串表示已确认不写文字。

原文、姓名、阅读顺序或方向变化不要求重新消字。区域、`layoutArea`、处置或实际原图变化会使对应底图验收失效。

`textBoxId` 归属保持唯一。不同区域的 `layoutArea` 与不同阶段的 `eraseMask` 可以重叠。后处理像素覆盖前处理像素。

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

整页排版属于「写回与验证」，只有导出或交付图片成果时执行。

# 写回与验证

`project-operation` 调用 `generateFiles` 时，文件生成服务直接完成图片排版与写出。图片不会进入 `writeback.files`，Agent 不修改排版输入，也不逐页接受或拒绝。

每张页面都按 `.image` 中的原始相对路径输出：

- 成功区域写入译文。
- 边距偏小、中心偏移和小字号属于警告，继续写入译文。
- 无法排版和越界属于文字渲染失败；消字失败和无法识读属于图片准备失败。以上区域均保留原文。应用字体无法绘制某个字形时由 Chromium 自动使用系统字体回退。
- 译文尚未完成属于失败，对应区域保留原文。
- 整页计算失败时输出原图，不影响其他页面。

文件生成服务在译文目录写入 `.lg-export-report.json`。Agent 只读取其中的 `summary`、文件 `path` 和区域条目，不根据文件目录推断状态。
区域条目使用 `success | warning | failure`，警告可以包含多个原因，失败包含一个原因。每个原因同时提供稳定 `code` 和按应用语言生成的自然语言 `reason`。普通警告只说明问题；原文回退与页面失败同时说明处理方式。

# 交付说明

对照 `.lg-export-report.json`、`clean.json` 与 `image.json` 汇报：

- `.image`、成品目录与成功、警告、失败、原文回退数量。
- `repair_failed`、`unreadable`、未译、无法排版和越界的页与区域。
- `intentional` 保留文字和确认为误检的检测框。
- 边距偏小、中心偏移和小字号警告。
