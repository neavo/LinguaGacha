---
name: image
description: 翻译、审校、分析、修改图片文件（含 .image 文件）前必须加载。
---

# 图片处理能力

本技能提供图片与漫画资产的端到端处理方法，技能脚本负责图片准备、成图和质控材料，应用提供工程译文快照、推理与绘字能力。

阶段导航：

|阶段入口|章节|
|---|---|
|来源调查|「来源调查」|
|导入准备|「环境与设备」「扫描与封包流水线」|
|原稿与条目|「条目状态与互斥」「气泡与文本规则」「旧包解包与维护」|
|写回与验证|「写回成图」「QA 集中视觉复核」「质控速查」「异常修复分支」|
|交付说明|「交付说明」|

> [!IMPORTANT]
> **看图与视觉复核的两条铁律**：
> 1. **严禁提前看图**：导入准备与条目翻译全自动运行，严禁打开任何图像；视觉核验统一在 QA 阶段一次完成。
> 2. **严禁切片放大**：放大不会恢复缺失细节，反而丢失分镜与语境；严禁脚本切片或局部缩放，全程保持整页视图。

# 来源调查

按 `project-operation` 调查来源，确认候选图片归属：

- 游戏目录内的图片先由引擎技能裁定，不得擅自拆离。
- 确认属于独立图片或漫画时，按本技能处理。
- 独立图片整批封装为一个 `.image` 资产（单图批次同样单独封装）。

# 导入准备

## 环境与设备

从 `read_skill` 返回的 `base_url` 动态导入脚本：

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
console.log(JSON.stringify({ missing: image.missing_models() }));
```

- 发现缺口时，告知用户：「首次使用需要下载约 300 MB 的依赖与模型，后续重复使用」。
- 调用工具安装依赖并下载权重：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
const image = await import(new URL('scripts/image.mjs', base_url).href);
await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
await image.prepare_models();
```

依赖或模型下载失败时，检查缺口并报告实际错误。

### 设备降级策略

默认使用 GPU。捕获 `image.DeviceFailure` 时，告知用户切换至 CPU，重试失败步骤且后续统一使用 CPU：

|入口|CPU 调用参数写法|说明|
|---|---|---|
|`scan`|`image.scan(sources, dir, 'cpu')`|第三参数传 `'cpu'`|
|`prepare`|`image.prepare(dir, selected, outDir, { device: 'cpu' })`|第四参数传 `{ device: 'cpu' }`|
|`repartition`|`image.repartition(scanDir, opts, prepDir, outDir, { device: 'cpu' })`|第五参数传 `{ device: 'cpu' }`|
|`prepare` (补做)|`image.prepare(scanDir, targets, outDir, { update, device: 'cpu' })`|选项传入 `update` 与 `device`|

其他异常按原样抛出。

## 扫描与封包流水线

导入准备是一次性全自动批处理，不介入人工看图：

1. **执行扫描**：整批 `sources` 传入 `scan`。每项提供 `path` 与 `relativePath`（以 `/` 分隔并保留原文件名）。
2. **收集选字**：自动全选已识别区域，不看诊断图，直接组装 `selected`。
3. **准备补丁**：调用 `prepare` 生成写字框与消字掩码。
4. **封装资产**：调用 `pack` 封装为 `.image` 包并提交工程。

```js
import { writeFile } from 'node:fs/promises';
const scan = await image.scan(sources, 'work/image/scan');
await writeFile('work/image/scan-result.json', JSON.stringify(scan), 'utf8');

const selected = scan.pages.flatMap(({ pageId, records }) =>
  records.map(({ regionId }) => ({ pageId, regionId })),
);
const prepared = await image.prepare(scan.directory, selected, 'work/image/book');
const packed = await image.pack(prepared.directory, 'work/image/book.image');
console.log(packed);
```

封包后按 `project-operation` 提交新增。更新工程已有来源时沿用「更新文件」。

# 原稿与条目

## 条目状态与互斥

导入完成后，条目按类别设置初始状态：

|文字类别|默认状态|说明|
|---|---|---|
|有框文字（气泡内）|`NONE`|默认待翻译|
|无框文字（`unframed`）|`EXCLUDED`|默认不翻译，满足特定条件方可启用|
|分格版条目|`NONE`|连体气泡首轮默认按分格版翻译|
|备用整泡版条目|`EXCLUDED`|与分格版条目互斥，作为备选保留|

- **互斥原则**：同一气泡严格只能启用一种版本（整泡版或分格版），严禁同时启用。
- **零看图翻译**：条目翻译纯按提取文本执行，不查阅原图；图文对照统一后置到 QA 阶段。
- **上下文构造**：向翻译流程组装上下文时，严格只传入当前启用的条目。

## 气泡与文本规则

- **换行语义**：普通 OCR 换行视为软换行，空行保留为段落分段。
- **连体气泡**：依照阅读流向通读上下文，保证语意连贯。

## 旧包解包与维护

维护已有 `.image` 资产时，通过脚本展开并读取：

```js
const unpacked = await image.unpack('sources/book.image', 'work/image/unpacked');
const { book, records } = await image.read(unpacked.directory);
```

- 原文修正写入 `package/items.json` 的 `message`，再重新封包提交。
- 若原图确有漏识别文字且包内无对应条目，从原图重新扫描。

# 写回与验证

## 写回成图

提交本次变更后，在同一次 `workspace_run` 中调用 `generateFiles(bilingual_files)`，再逐个处理 `writeback.files` 中的图片资产。

```js
import path from "node:path";
import { generateFiles } from "@lg/project";
const image = await import(new URL("scripts/image.mjs", base_url).href);
const generated = await generateFiles(bilingual_files);
for (const asset of generated.writeback?.files ?? []) {
  if (!/\.image$/iu.test(asset)) continue;
  console.log(await image.render({
    asset_path: asset,
    source: path.join("sources", asset),
    input: path.join(generated.writeback.input_path, asset, "items.json"),
    output: path.join(path.dirname(generated.output_path), "image", asset),
  }));
}
```

`image.render()` 在输出目录下生成译图、双拼对照图及 `report.json` 质控报告，供后续集中复核与交付使用。

## QA 集中视觉复核

**这是全流程唯一允许看图的阶段**，导出成图后，整页逐页集中看图核验：

1. 使用「写回成图」中 `image.render()` 同时生成的双拼图和报告。
2. 读取每册 `report.path` 指向的报告，将每页的 `files[].qa` 相对路径与 `qa_path` 拼接得到图片路径。
3. 逐页打开整页双拼图，一并核验图面质量与译文，严禁局部切片或放大。
4. 审查图面标记：
   - **左原右译**：左侧为原图，右侧为译图。
   - **黄色标记框**：表示当前区域仍处于待译状态。
   - **红色标记框**：表示当前区域消字或写字失败，或整泡版与分格版同时启用，查阅报告原因。
5. **终结条件**：整页质控无异常时直接交付，发现瑕疵时按速查表修复。

## 质控速查

发现视觉瑕疵时，对照下表采取相应动作：

|观察到的图面现象|判定原因|处理动作|
|---|---|---|
|发现 OCR 识别文本明显有误|识别错误|更新对应条目的原文与译文，重新生成译图|
|页边广告、装饰字无需翻译却被擦除或残缺|误擦除无需翻译区域|封包前从 `selected` 移除，或在工程中将条目设为 `EXCLUDED` 后重新生成|
|发现关键叙事或对白的无框文字未翻译|无框文字默认未启用|启用对应条目（设为 `NONE` 或恢复 `PROCESSED`），补齐译文后重新生成|
|同一气泡的整泡版与分格版同时启用|版本冲突（`variant_conflict`）|只保留一个版本启用，重新生成并检查该组|
|整泡版比分格版更贴合原稿气泡表现|分格切分不合理|在工程条目中切换版本状态（禁用分格版，启用整泡版）|
|连体气泡一格拥挤、一格留白过多|格界划分不合理或漏译|分格正确时核对空格是否漏译；格界错误时执行连体气泡纠正|
|译文填入错误的气泡格内|分格对应错位|对照原字位置与阅读流向，调换或写回正确条目|
|消字失败，有明显残字、网点或线条损伤|背景复杂填色失效|对受损区域补做轮廓填字|

## 异常修复分支

### 1. 启用条目与切换版本

**无框文字启用标准**（仅满足下列之一方可启用）：
- 文字承担角色对白、独白、旁白或正文功能。
- 文字为章节标题或关卡名称。
- 读者理解剧情转折或场景切换所必需的关键线索。
- *氛围艺术字、拟音词默认不翻译；拿不准时保留原图*。

**操作步骤**：
1. 通过 `image.read(工作目录).book` 查询对应页与区域编号。
2. 整泡条目的 `parts` 字段对应分格条目编号。
3. 同一批次内将旧版设为 `EXCLUDED`，新版设为 `NONE`（需补译）或 `PROCESSED`（已有译文）。
4. 提交工程变更，重新生成并复查受影响页的双拼图。

### 2. 纠正连体气泡分格

当默认的整泡版与分格版均无法正确表达格界时执行：

1. **诊断并查看编号**：
   调用 `image.inspectGroup(scan.directory, { pageId, group }, 预览路径)` 生成编号图，从返回的 `lines` 读取 OCR 框编号。
2. **重新划分格界并封包**：
   按阅读顺序划分各格，每个 OCR 框恰好归入一格，不翻译的格标记 `translate: false`：

```js
const result = await image.repartition(
  scan.directory,
  {
    pageId,
    group,
    parts: [
      { textBoxIds: firstBoxIds, translate: true },
      { textBoxIds: secondBoxIds, translate: true },
    ],
  },
  prepared.directory,
  'work/image/repartitioned',
  { device },
);
await image.pack(result.directory, 'work/image/repartitioned.image');
```

3. **提交更新**：按「更新文件」提交，仅补译受影响区域，并复查该页双拼图。若无法可靠分割，保留原图并记录页码与区域。

### 3. 补做轮廓填字

当纯色消字在复杂网点或背景上产生残损时执行：

1. **指定目标区域**：复用同次扫描，修复区域标记为 `{ pageId, regionId, contour: true }`。
2. **增量准备**：调用 `prepare` 传入已准备目录（若曾纠正分格，`update` 使用最新准备目录）：

```js
const updated = await image.prepare(
  scan.directory,
  targets,
  'work/image/contour-fix',
  { update: prepared.directory, device },
);
await image.pack(updated.directory, 'work/image/contour-fix.image');
```

3. **提交更新**：封包后按「更新文件」提交。程序复用其余补丁并保留写字框与原文，补做后的消字像素自动应用于该气泡的两种版本。

# 交付说明

交付汇报时，按下述结构向用户说明成果与质控事实：

- **基本产物**：输出目录路径、总生成页数与区域统计。
- **异常区域说明**：按页列出未翻译、消字失败或写字失败的区域编号与报告原因。
- **质控复核记录**：说明 QA 视觉复核的抽查/覆盖范围及修复的问题；若因环境受限未查看成图，如实说明。
