---
name: image
description: 翻译、审校、分析、修改图片文件（含 .image 文件） 前必须加载。
---

- 应用负责文字识别、气泡分格、阅读排序、消字和译图排版。
- 图片技能的脚本校验准备结果，并将其封装成 `.image`。
- 你负责判断图片归属、核对旧包、取舍翻译内容和修正 OCR 原文。
- 处理完成后，向用户说明实际结果。

常规翻译流程分三步。

1. 准备原图并导入工程。
2. 按文本筛选和翻译条目。
3. 译后集中看图，做一次整页 QA。

图片已经导入时，从本次需要的阶段开始。

调用 `read_skill` 读取本技能后，用返回的 `base_url` 导入脚本。

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
```

# 来源调查

先确认用户想用图片做什么，再选择处理方式。

- **游戏目录中的图片**先由对应引擎技能判断归属，再把确认需要独立处理的图片交给本技能。
- **准备导入或交付译图**时，列出指定批次的图片路径并确定页序。
- **只查看或分析图片**时，直接读取用户指定的原图即可。

需要导入时，由后续的 `prepare` 读取原图、解析元数据并计算摘要。

# 导入准备

## 准备运行环境

制作或重做 `.image` 前，先在独立调用中用 `missing_models()` 检查模型缺口。

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
console.log(JSON.stringify({ missing: image.missing_models() }));
```

本次任务首次发现需要下载依赖或模型时，告诉用户「首次使用需要下载约 300 MB 的依赖与模型，后续重复使用」。

然后在新的调用中按脚本提供的清单安装依赖，并准备模型。

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
const image = await import(new URL('scripts/image.mjs', base_url).href);
await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
await image.prepare_models();
console.log(JSON.stringify({ missing: image.missing_models() }));
```

按环境准备结果继续。

- **准备成功**后，开始处理原图。
- **准备失败**时，重新检查缺口，向用户说明还缺哪些资源。

## 从原图制作 `.image`

把来源调查得到的图片列表 `sources` 按已确认的页序传给一次 `prepare` 调用。

每页的 `relativePath` 相对于本批图片共同的来源目录。

- 保留原目录和文件名。
- 使用 `/` 分隔路径。
- 确保不同页面的路径在忽略大小写后仍可区分。

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
const prepared = await image.prepare(
  sources.map((source) => ({
    path: source.path,
    relativePath: source.relativePath,
  })),
  'work/image/ch01',
);
console.log(JSON.stringify(prepared, null, 2));
```

`prepare` 默认使用 GPU。

GPU 首次抛出 `image.DeviceFailure` 时，按以下步骤切换到 CPU。

1. 告诉用户「GPU 加速不可用，本次任务已切换至 CPU 模式，处理速度会比较慢」。
2. 在新的调用中传入 `{ device: 'cpu' }`，用相同的来源和工作目录重跑整批。
3. 本次任务后续的图片继续使用 CPU。

CPU 重跑失败，或遇到模型、输入、环境、资源关闭等其他错误时，停止准备并报告实际错误。

用 `prepared.pages` 核对每页的准备结果，无需逐页看图。

- 原始相对路径。
- 识别出的文字框数和区域数。
- 消字失败的区域及原因。
- 标出区域边界和编号的诊断预览路径 `preview_path`。

常规导入在准备成功后直接封包，消字失败的区域仍随图片导入。

生成译图时，应用会保留消字失败区域的原图。

用户明确要求在导入前检查 OCR 或气泡分格时，查看指定范围的 `preview_path`。

确认 OCR 原文有误时，在封包前修改 `package/items.json` 中对应条目的 `message`。

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
const packed = await image.pack('work/image/ch01', 'work/image/ch01.image');
console.log(packed);
```

`pack` 校验包内成员和像素后写出 `.image`。

按 `project-operation` 的流程识别并提交新包。

需要为已导入的图片重新分格时，先从原图重新准备。

再按「更新文件」替换对应资产，由工程继承可复用的译文。

## 处理已有的 `.image`

用 `image.unpack(来源, 新工作目录)` 把原包展开到新工作目录的 `package/`。

- **当前结构的包**
  - 用 `await image.read(工作目录)` 读取 `book`、`records` 和 `clean`。
  - 只修正 OCR 原文时，修改 `package/items.json` 中对应条目的 `message`。
- **需要整理成当前结构的旧包**
  - 根据解包后的内容，确认页面、区域、原文和掩码的对应关系。
  - 用 `image.describe_package()` 查看当前三个 JSON 的结构，再据此整理工作副本。
  - 对应关系无法确认时，从原图重新准备，或记录为未决。

核对工作副本后，用 `image.pack()` 写出新包。

# 原稿与条目

应用为每个识别出有效文字的区域生成一条原文。

连体气泡的格界清楚时，应用将各格拆成相邻条目，否则保留整泡。

阅读和翻译条目时，按以下规则理解原文。

- 读相邻格的原文和译文，按条目顺序确认跨格对白连起来读得通。
- 将 OCR 原文的普通换行视为画面分行，在翻译时按软换行处理。
- 遇到空行时，保留段落区别。

常规选条、翻译和文字审校使用 OCR 原文与邻近文本等文字证据。

## 翻译目标

用户明确指定了哪些条目应译、哪些应保留原图时，按其要求处理。

普通翻译和续译需要核对本次范围内的两种条目。

- `NONE` 是待译条目。
- `DUPLICATED` 可能在生成译图时复用同文条目的译文，因此也要判断是否应保留原图。

### 找到条目对应的页面和区域

1. 按工程条目的 `file_path` 分组。
2. 复用该包的工作目录，或用 `image.unpack` 将 `sources/<file_path>` 解到新的工作目录。
3. 用 `await image.read(工作目录)` 读取包内容，再按条目的 `row_number` 找到 `records` 中对应的记录。
4. 用记录的 `pageId` 和 `regionId` 找到 `book` 中对应的页面和区域。

根据区域的 `kind` 决定如何处理。

- **气泡文字（`bubble`）**默认翻译。
- **无框文字（`unframed`）**按页合批读取工程条目的 `src`，结合邻近条目判断用途。

### 判断无框文字是否需要译文

无框文字只有在明确需要读者读懂时才翻译，不确定是否需要翻译时，一律不译，保留原图：

- 翻译明确属于旁白、对白、独白、章节标题或正文的文字，以及交代场景切换或提供情节线索的信息。
- 保留用作装饰或烘托氛围的拟声词、动作字和背景文字。
- 单凭「今日歇业」无法确定告示的用途时，保留原图。上下文明确角色因歇业而改道时，翻译告示。

### 提交筛选结果

确认应译但原文读不准时，记录条目的 `item_id`、页面和区域，在整页 QA 时核对原文。

- `NONE` 保持待译。
- `DUPLICATED` 先设为 `EXCLUDED`，避免在原文确认前复用同文译文。

1. 把按上述标准保留原图的条目设为 `EXCLUDED`，保留已有 `dst`。
2. 核对回执并读取最新快照，因为排除条目可能改变同文组的状态。
3. 从本次范围内确认应译且原文可辨认的条目中，选取状态为 `NONE` 的条目提交翻译。
4. 状态仍为 `DUPLICATED` 且需要译文的条目沿用工程的同文复用。

审校范围包含译文取舍时，用同一规则检查范围内的 `PROCESSED` 和 `DUPLICATED` 无框条目。

# 翻译后检查

本次译文、条目状态及同一任务中的审校修改提交后，调用一次 `generateQA()`。

```js
import { generateQA } from '@lg/image';
const qa = await generateQA();
```

打开 `qa.report.path` 指向的报告，用 `qa.output_path` 拼接报告里的 `assets[].files[].path` 得到预览路径。

用 `ws.emitImage(path, { maxEdge: 3840 })` 按页分批查看本次范围内的双拼，左侧是原图，右侧是译图。

译图用带编号的色框标出异常区域。

- 黄色框表示翻译未完成。
- 红色框表示消字或排版失败。

按框旁的区域编号查阅报告中的原因。

像读漫画一样看完整页面，核对待确认的原文、跨格对白和阅读顺序，留意明显影响阅读的残字、错格或难读译文。

发现无框文字的译文取舍问题时，按「判断无框文字是否需要译文」处理。

常规 QA 看到整页为止，用户明确要求检查局部细节时再裁图或放大。

- **应保留原图**时，设为 `EXCLUDED`，保留已有 `dst`。
- **确认应译**时，优先使用已有译文。
  - 此前排除但有可用 `dst` 的条目恢复为 `PROCESSED`。
  - 缺少可用译文时，按 `translation` 的「当前对话翻译」补译。
- **需要读懂的原文仍无法辨认**时，记录为未决并保留原图。
  - `NONE` 保持待译，已有或可复用译文的条目设为 `EXCLUDED`。
- **红框区域或其他影响阅读的问题**，记录页面、区域和具体现象。
  - 任务包含原稿修正时，按「导入准备」修正 OCR 原文或分格，更新 `.image` 后补译受影响的条目。

提交修正后核对写入回执。

用户要求验收修正后的成图时，只复查受改动影响的页面。

# 写回与验证

正式交付时，按 `project-operation` 的「导出与交付」调用 `generateFiles`。

应用根据最新工程状态排版并生成正式译图。

按以下步骤核对结果。

1. 读取返回的 `image_report`，再沿 `path` 打开 `.lg-export-report.json`。
2. 核对目标页面是否都有输出。
3. 查看各区域实际输出的是原图还是译文，并按报告核实失败原因。

# 交付说明

按实际交付向用户说明 `.image`、成品目录、页数和区域结果。

按页面和区域列出仍未解决的问题，例如原文无法辨认、消字失败或译文排不下。
