---
name: image
description: 识别、消字、翻译、审校、修改漫画或图片，或为漫画或图片生成译图与无字底图前必须加载。
---

本技能处理漫画与静态图片的有框、无框文字。目标是保留阅读理解所需内容，生成可恢复的无字底图与译图。

第一阶段按页生成少量消字候选。独立模型同时看到完整原页与该页全部候选拼图，每个区域只返回一个候选编号、`preserve` 或 `failed`。不要让模型生成像素文件、掩码路径、自然语言理由或第二轮复核请求。

# 归档契约

|路径|内容|
|---|---|
|`image.json`|`ImageBook`：页身份、原图、区域和排版输入|
|`items.json`|`ImageRecord[]`：按阅读顺序排列的原文与可选说话人|
|`clean.json`|已提交无字底图、实际消字掩码和 `complete \| partial` 状态|
|`originals/<pageId>.<ext>`|原始 PNG 或 JPEG 字节|
|`masks/<pageId>/<regionId>.png`|区域归属及译文排版上限|
|`erase-masks/<pageId>/<regionId>.png`|已选候选真正改动的像素；填色与 LaMa 统一使用|
|`clean/<pageId>.png`|EXIF 方向归一化后的已提交无字底图|

`ImageRegion` 的业务字段：

|字段|约束|
|---|---|
|`regionId`|页内唯一稳定标识|
|`kind`|`bubble` 有框文字，`unframed` 无框文字|
|`disposition`|`translate` 或 `preserve`|
|`preserveReason`|仅 `preserve` 使用：`intentional`、`unreadable`、`repair_failed`|
|`selection`|已注册的二值选区或 `null`|
|`direction`|`vertical-rl`、`horizontal-tb` 或 `null`|
|`backgroundColor`|排版背景代表色 `[R,G,B]` 或 `null`|

`confirmed: true` 时，每个 `translate` 区域必须有非空已注册选区、方向、背景色和非空原文。`preserve` 区域的方向与背景色必须为 `null`。消字方法只属于候选运行，不写入区域。

# 应用接口

从 `@lg/image` 导入：

|入口|用途|
|---|---|
|`prepare`|归档原稿，运行气泡分割与整页文字检测，生成初始证据|
|`read`|读取草稿、证据和已提交底图状态|
|`register_regions`|按未归属文字框编号注册或替换无框区域|
|`apply`|确认区域元数据、原文和阅读顺序|
|`erase`|生成区域候选、拼图和按页批量请求清单，不提交底图|
|`review`|解析按页选择，组合已选像素，提交最终区域状态与底图|
|`pack`、`restore`|封装或恢复 `.image`|
|`prepare_text`、`render`、`publish`|生成写字计划、排版并发布成品|

# 环境准备

首次运行前安装依赖并准备模型：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
import * as image from '@lg/image';

await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
if (image.missing_models().length > 0) await image.prepare_models();
```

# 区域准备

调用 `prepare`，已有工作目录改用 `read`：

```js
const prepared = await image.prepare({
  sources: ['uploads/page-001.jpg', 'uploads/page-002.jpg'],
  workDirectory: 'work/image/ch01',
  device: 'cpu',
});
```

逐页查看 `evidence[].preview`、`fillPreview`、重点裁图和规范化原页。`textBoxes` 中每项含 `box` 与 `ownerRegionId`：

- `ownerRegionId` 非空时，文字框已归属气泡区域，不能重复注册。
- `ownerRegionId` 为 `null` 时，结合方向、间距、对齐和语义把属于同一段文字的框分组。
- 同一框只能进入一个分组。跨区域或语义含糊时先保留为未决，不复制。
- 对明确漏检可作一次局部识读；仍无法形成合法区域时登记已知缺口，不伪造掩码。

用 `register_regions` 注册无框分组。该入口生成选区、验证框归属与区域互斥，并使旧候选失效：

```js
const current = await image.read('work/image/ch01');
const registered = await image.register_regions({
  workDirectory: 'work/image/ch01',
  expectedRevision: current.revision,
  pages: [{
    pageId: current.book.pages[0].pageId,
    groups: [
      { regionId: 'u0001', textBoxIds: [3, 4] },
      { regionId: 'u0002', textBoxIds: [6] },
    ],
  }],
});
```

无框选区是排版范围。候选实际消字掩码会更小。不要让 `apply` 或工作区脚本写掩码文件。

整理区域时：

- 对白、旁白和理解画面所需文字使用 `translate`。
- 氛围性装饰文字保留后不影响理解时才使用 `preserve` + `intentional`。
- 无法识读使用 `unreadable`。应翻译但当前无法形成合法区域使用 `repair_failed`。
- 按自然阅读顺序排列区域和 `records`。填写原文、可选说话人、方向与背景代表色。看不清时不要猜。

将整理后的完整 `pages` 与 `records` 传给 `apply`，使用当前 `revision` 并设置 `confirmed: true`。保存返回的草稿为 `applied`。

# 候选选择与提交

调用 `erase`。它为每页生成填色、笔画掩码 LaMa、文字框范围 LaMa 中适用且不重复的候选，并返回 `requestFile`：

```js
const erased = await image.erase({
  workDirectory: 'work/image/ch01',
  expectedRevision: applied.revision,
});
```

每个请求已经包含：

1. 极简选择规则与合法编号。
2. 一张完整原页图片。
3. 该页全部候选拼图。`O` 只表示原图对照，不可选择。

`requestFile === null` 表示没有可发送请求。查看 `erased.pages[].error`：容量失败页会在提交时按 `repair_failed` 收尾。全保留页不调用模型，但仍由 `review` 提交原图底图。

本阶段明确允许调用 `batch_llm_request`。不要修改生成的请求，不要拆页，不要追加放大、裁图或理由追问：

```js
const batch = await batch_llm_request({
  model_usage: 'agent',
  request_file: erased.requestFile,
});
```

从 `batch.result_file` 读取索引，再读取各成功项的 `response.text`。按请求 `id` 关联 `pageId`，原样交给 `review`：

```js
const committed = await image.review({
  workDirectory: 'work/image/ch01',
  runId: erased.runId,
  expectedRevision: erased.revision,
  pages: [
    { pageId: erased.pages[0].pageId, response: '{"r0001":"A","u0001":"failed"}' },
  ],
});
```

模型正文只能是 JSON 对象。每个值只能是当前区域的候选编号、`preserve` 或 `failed`：

- 合法候选：采用该候选像素，区域继续进入翻译和写字。
- `preserve`：原图不变，提交为 `intentional`。
- `failed`：原图不变，提交为 `repair_failed`，归档状态为 `partial`。
- JSON 损坏、缺项、值类型错误或未知编号：仅对应区域按 `failed` 收尾。
- 未知区域键只记录协议错误，不能创建区域。
- 运行过期时整份拒绝。相同运行和相同选择重放时返回已有提交，不重复计算。

网络失败、取消或批量服务未完成属于运行错误。不要把它们伪装成模型的 `failed`，也不要自动重发可能重复计费的请求。

提交后直接调用 `pack`。不存在额外的整页消字接受/拒绝循环：

```js
const packed = await image.pack('work/image/ch01', 'work/image/ch01.image');
```

# 写字与发布

工程导入或更新 `.image` 后，提交译文并调用 `generateFiles` 取得写字快照。`text: null` 表示未译，`text: ''` 表示明确留空，非空文本进入排版。

1. 用 `restore` 恢复工作目录。
2. 用 `prepare_text` 生成整体 `C0` 与可用分区候选。
3. 查看原页和分区预览。多块分配必须逐字符守恒，不得在分配中改写译文或拆开字素。
4. 用 `render` 排版。`ready` 只代表程序门禁通过，仍须查看译图，核对文字完整、阅读顺序、字号和遮挡。
5. 逐页形成视觉决定，再调用 `publish({ workDirectory, outputDirectory, expectedRevision, source: { kind: 'rendered', renderId, decisions } })`。`decisions` 中每项为 `{ pageId, decision: 'accept' }` 或 `{ pageId, decision: 'reject', reason }`。排版失败不能自动回到消字阶段搜索更多候选。

```js
const draft = await image.restore('sources/ch01.image', 'work/image/ch01');
const plan = await image.prepare_text({
  workDirectory: 'work/image/ch01',
  inputPath: `${writeback.input_path}/ch01.image/items.json`,
  expectedRevision: draft.revision,
});
const rendered = await image.render({
  workDirectory: 'work/image/ch01',
  planId: plan.planId,
  assignments: [],
  expectedRevision: draft.revision,
});
```

遇到 `no_fit`、块顺序错误或字号失衡时，调整写字候选与文字分配。译文过长时先修订工程译文，再重新生成快照。缺字、未译、排版失败或视觉拒绝的页面保留在 `incomplete/`，不能混入正式成品。

# 交付说明

对照 `delivery.json`、`clean.json` 与 `image.json` 汇报：

- `.image`、成品目录与 `complete \| partial` 状态。
- `repair_failed`、`unreadable`、未译、`no_fit`、缺字和视觉拒绝的页与区域。
- `intentional` 保留的装饰文字。
- 小字号但已视觉确认可读的区域。
- 全页无待译区域时，说明已核对原图和文字检测证据。
