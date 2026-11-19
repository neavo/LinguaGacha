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
|原稿与条目|「条目初始状态」「气泡与文本规则」「旧包解包与维护」|
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

## 条目初始状态

导入完成后，工程仅包含当前版式的区域条目，并按类别设置初始状态：

|文字类别|默认状态|说明|
|---|---|---|
|有框文字（气泡内）|`NONE`|默认待翻译|
|无框文字（`unframed`）|`EXCLUDED`|默认不翻译，满足特定条件方可启用|

- **零看图翻译**：条目翻译纯按提取文本执行，不查阅原图；图文对照统一后置到 QA 阶段。
- **单套版式保证**：工程仅导入当前版式条目，未选中的备用版式留在资产包内，无需手动互斥管理。

## 气泡与文本规则

- **换行与空格**：
  - 译文保留显式换行与空格，成图时强制断行。
  - 软换行由排版引擎自动计算，仅在需要固定分行时显式换行。
  - 纯空白译文视为空译文，成图时仅消字不写字。
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
   - **黄色标记框**：表示当前区域处于待译状态。
   - **红色标记框**：表示当前区域异常保留原图（消字失败或排版失败），查阅报告并按速查表处理。
5. **终结条件**：整页质控无异常时直接交付，发现瑕疵时按速查表修复。

## 质控速查

发现视觉瑕疵时，对照下表采取相应动作：

|观察到的图面现象|判定原因|处理动作|
|---|---|---|
|红色框保留原图且报告提示 `layout_no_fit`|排版放不下（字数过多、断行不当或字号过大）|按「字号与排版微调」调整断行/字数，或试调字号后重新出图；复杂连体气泡转分格流程|
|消字处有残字、网点破损，或报告提示 `erase_failed`|背景复杂填色失效|对受损区域调用 `prepareAndPack` 补做轮廓填字（仅修消字，不扩展排版空间）|
|画面有多个气泡，文字却挤在其中一侧|连体气泡未分格排版|按「已知格界的气泡拆合」切换为分格排版，替换资产后补译|
|黄色框标出且图上仍为原文|条目遗漏翻译（处于待译）|补齐对应条目译文后重新出图|
|关键文字保留原图未翻译|无框文字默认未启用|按「启用无框文字」将条目设为 `NONE`，补齐译文后重新出图|
|页边广告、纯装饰字被擦除或残缺|误擦除无需翻译区域|在工程中将条目设为 `EXCLUDED` 后重新生成|
|对照双拼发现 OCR 文本明显有错漏|OCR 识别偏差|更新对应条目的原文与译文，重新生成译图|

## 异常修复分支

### 1. 已知格界的气泡拆合

**核心原则：以拆为主**。整页 QA 观察到画面有多个明显气泡（如连体葫芦泡、双叶泡），文字却全部堆在其中一侧而另一侧留白时，**一律执行拆分**：

1. **切换准备目录版式**：
   在准备目录（或解包目录）中调用 `splitBubble`（极少需要合回整泡时调用 `mergeBubble`）：
   ```js
   const result = image.splitBubble(preparedDir, { pageId, regionId });
   // 或合回整泡：image.mergeBubble(preparedDir, { pageId, regionId });
   ```
   - `regionId` 传入整泡或任一子格编号均可定位同组。
   - 返回 `{ status: "prepared" }` 表示切换成功。
   - 返回 `{ status: "repartition_required" }` 表示无预置对应关系，转入「重新划分格界与封包」。
2. **重新封包与替换资产**：
   - 调用 `image.pack(preparedDir, 'work/image/book.image')` 重新封包。
   - 按 `project-operation` 的 `files.replaces`（「更新文件」）提交资产替换并审批。
   - 工程自动按物理区域继承已有译文。
3. **补译受影响条目**：
   - 读取最新工程快照，补齐新出现的 `NONE` 待译条目。
   - 重新执行写回成图并复核该页。

### 2. 重新划分格界与封包

收到 `repartition_required`、原有分格切分错误、或需要合回但无预置整泡时执行：

1. **获取原 OCR 框**：
   调用 `image.inspectGroup(scanDir, { pageId, group }, previewPath)` 生成编号图，从返回的 `lines` 读取 OCR 框编号。
2. **划分分组并一步封包**：
   按阅读顺序将每个 OCR 框恰好编入一组（每个框恰好出现一次；若合回整泡则全部放入同一组）：
   ```js
   const result = await image.repartitionAndPack(
     scanDir,
     {
       pageId,
       group,
       parts: [
         { textBoxIds: firstBoxIds, translate: true },
         { textBoxIds: secondBoxIds, translate: true },
       ],
     },
     preparedDir,
     'work/image/repartitioned',
     'work/image/repartitioned.image',
     { device },
   );
   ```
3. **替换资产与补译**：
   以返回的 `result.package` 按 `project-operation` 的 `files.replaces`（「更新文件」）提交。
   核对回执，补译受影响条目并复查该页。
   **保留 `scanDir` 和最新准备目录至 QA 完成**，供后续局部纠错复用。

### 3. 补做轮廓填字与封包

纯色消字在复杂网点或彩色背景上产生残损、断裂（报告提示 `erase_failed` 或目视残字）时执行。轮廓补做复用原掩码，仅用于修复消字质量，无法为排版腾出空间；排版放不下（`layout_no_fit`）应调整断行或字号。

1. **指定目标区域**：复用同次扫描，修复区域标记为 `{ pageId, regionId, contour: true }`。
2. **一步准备并封包**：
   ```js
   const result = await image.prepareAndPack(
     scanDir,
     targets,
     'work/image/contour-fix',
     'work/image/contour-fix.image',
     { update: preparedDir, device },
   );
   ```
   （若此前曾做过连体气泡纠错，`update` 传入最新一次成功的准备目录；若仅重试封包，可直接传本次已成功的准备目录）。
3. **提交更新**：按 `files.replaces` 提交，重新生成并核验新补丁的对比度与消字质量。

### 4. 字号与排版微调

遇到 `layout_no_fit`、文字拥挤或需精确控制版面时执行：

1. **排版与断行微调**：
   - 显式换行符与空格直接进入排版并强制断行。
   - 在译文条目中调整换行位置或精简措辞，重新出图复核。
2. **字号试排（快速验证）**：
   - 在 `image.render()` 中传入 `fontSizes` 临时覆盖字号（原图像素整数，≥4；传入 `null` 临时恢复自动计算）：
     ```js
     await image.render({
       asset_path: 'book.image',
       source: 'sources/book.image',
       input: path.join(generated.writeback.input_path, 'book.image', 'items.json'),
       output: 'work/image/preview',
       fontSizes: [{ pageId, regionId, fontSize: 18 }],
     });
     ```
   - 试排仅在临时输出目录生成译图与报告，便于快速比对效果，不改动工程与资产。
3. **固化字号（随资产持久保存）**：
   - 试排满意且需要跨会话持久复现时，将确认字号写入准备目录（或解包目录）：
     ```js
     image.setFontSizes(preparedDir, [{ pageId, regionId, fontSize: 18 }]);
     await image.pack(preparedDir, 'work/image/book.image');
     ```
   - 按 `project-operation` 的 `files.replaces` 提交资产替换，后续重新生成自动沿用包内字号。

### 5. 启用无框文字

**无框文字启用标准**（仅满足下列之一方可启用）：
- 文字承担角色对白、独白、旁白或正文功能。
- 文字为章节标题或关卡名称。
- 读者理解剧情转折或场景切换所必需的关键线索。
- *氛围艺术字、拟音词默认不翻译；拿不准时保留原图*。

启用时通过常规条目更新将对应条目设为 `NONE`，补齐译文后重新出图。

# 交付说明

交付汇报时，按下述结构向用户说明成果与质控事实：

- **基本产物**：输出目录路径、总生成页数与区域统计。
- **异常区域说明**：按页列出未翻译、消字失败或写字失败的区域编号与报告原因。
- **质控复核记录**：说明 QA 视觉复核的抽查/覆盖范围及修复的问题；若因环境受限未查看成图，如实说明。
