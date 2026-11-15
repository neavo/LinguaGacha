---
name: image
description: 识别、消字、翻译、审校、修改漫画或图片，或为漫画或图片导出无字底图与译文前必须加载。
---

本技能处理漫画页与带气泡图片的闭合文字容器定位、原文与填色确认、纯色消字、视觉验收、`.image` 归档及无字底图导出。海报、招牌、衣服字与无框自由字不作为自动消字目标；容器内含装饰或底纹时，填色会整体覆盖选区内部，不能整体覆盖时整块保留。

阶段导航：

|阶段入口|章节|
|---|---|
|来源调查|「来源调查」|
|导入准备|「环境准备」「检测与取证」「确认与纯色消字」「视觉验收」「打包、导入与更新」|
|原稿与条目|「原稿与条目」|
|写回与验证|「写回与验证」|
|交付说明|「交付说明」|

# 原稿与条目

`.image` 条目的翻译与审校须结合原图视觉翻译，对照 `sources/<file_path>/originals/<pageId>.<ext>`、阅读顺序、文字方向与画面语境核对说话人、语气和指代。

项目导入 `.image` 后，`sources/<file_path>/` 解压为同名目录：

|成员|说明|
|---|---|
|`image.json`|`ImageBook`：页尺寸、旋转角度、原图引用、区域与已确认状态|
|`items.json`|`ImageRecord[]`：按全书 `translate` 区域顺序排列，数组下标即项目条目 `row_number`；全书无待译区域时为 `[]`|
|`clean.json`|`ImageClean`：整包状态（`complete \| partial`）及每页无字底图与生效掩码映射|
|`originals/<pageId>.<ext>`|原始图片字节（PNG 或 JPEG）|
|`clean/<pageId>.png`|EXIF 方向归一化后的无字底图 PNG|
|`masks/<pageId>/<regionId>.png`|与归一化页面同尺寸的 8-bit 单通道二值 PNG（仅含 `0` 与 `255`），供 `image.json` 的 `selection` 与 `clean.json` 的 `mask` 共用|

`image.json` 中每个 `ImageRegion` 的字段契约：

|字段|约束|
|---|---|
|`regionId`|页内唯一标识，如 `r0001`|
|`disposition`|`"translate"`（抹除并翻译）或 `"preserve"`（保留原图不填色）|
|`preserveReason`|仅 `preserve` 必填：`"intentional"`（有意保留）、`"unreadable"`（原文无法辨认）或 `"repair_failed"`（漏检、选区为空或填色破损后降级保留）|
|`selection`|`{ path, sha256 } \| null`，指向 `masks/<pageId>/<regionId>.png`|
|`direction`|`"horizontal-tb" \| "vertical-rl" \| null`|
|`fill`|`{ color: [R, G, B] } \| null`，RGB 为 `0..255` 整数|

- `confirmed: true` 时，每个 `translate` 区域必须具备非空且已注册的 `selection`、`direction`、`fill`，不得含 `preserveReason`，且在 `items.json` 中有对应非空原文 `message`（`name` 可选）。
- `preserve` 区域不改动原图像素：已检出候选转保留时保留原 `selection`；模型漏检或 `empty_selection` 的文字容器登记为 `preserve` + `preserveReason: "repair_failed"`（或 `"unreadable"`）且 `selection: null`，可读原文一并记入 `records`，使已知缺口进入 `partial` 状态而不伪造掩码。
- 所有含非空 `selection` 的区域在同页内像素归属两两互斥。

工作空间在 `work/image/<资产名>/` 下维护工程目录，真源为 `draft.json`、`originals/` 与 `masks/`；`normalized/`、`evidence/`、`runs/`、`reviewed/` 与 `cache/` 均为派生或运行固化目录。

# 来源调查

1. 扫描输入路径，筛选静态不透明图片（`.png`、`.jpg`、`.jpeg`）。含透明通道、动图或损坏文件直接排除并记录原因。
2. 游戏目录内的立绘、UI 与贴图优先归属对应游戏引擎技能，不按独立漫画导入。
3. 同一话、同一卷或同一批次页面按自然页序合成一个 `.image` 包；单张独立插图或立绘按单文件一个 `.image` 包组织，分包与路径规则遵循 `project-operation`。

# 环境准备

仅 `image.prepare(...)` 需要运行推理模型与工作区依赖；`read`、`apply`、`erase`、`review`、`pack`、`restore` 与 `publish` 均不启动推理 Worker。

首次调用 `image.prepare` 前，在 `workspace_run` 中检查并补齐依赖与模型：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
import * as image from '@lg/image';

await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
if (image.missing_models().length > 0) await image.prepare_models();
```

- 依赖常量：`image.IMAGE_DEPENDENCIES.npm`（`onnxruntime-node`）与 `image.IMAGE_DEPENDENCIES.python`（`numpy`、`opencv-python-headless`）。
- 模型：仅 `bubble` 单模型（MangaLens 气泡与文字框实例分割）。
- 推理设备：`prepare` 的 `device` 支持 `'cpu' | 'gpu'`，默认 `'cpu'`。

# 检测与取证

调用 `image.prepare` 完成原图归档、方向归一化、实例分割、内缩互斥选区、主色估计与视觉取证图生成，或用 `image.read` 读取已有工作目录：

```js
import * as image from '@lg/image';

await image.prepare({
  sources: ['uploads/page-001.jpg', 'uploads/page-002.jpg'],
  workDirectory: 'work/image/ch01',
  device: 'cpu',
});

const draft = await image.read('work/image/ch01');
```

`prepare` 生成的内容：
- 对每个候选闭合容器填补内部孔洞并内缩轮廓，按置信度从高到低分配互斥像素归属，估计内缩区域主色（浅近白中性色统一收敛为 `[255, 255, 255]`）。
- 候选状态 `candidate.status`：
  - `'ready'`：拥有非空互斥选区，进入初始 `draft.book.pages[].regions`（默认 `disposition: 'translate'`、`confirmed: false`），在 `evidence/<pageId>/preview.png` 上绘制橙色原始轮廓、绿色内缩选区轮廓与 `regionId`，并生成 `evidence/<pageId>/crops/<regionId>.png` 裁片。
  - `'empty_selection'`：内缩后选区为空，仅保留在 `evidence[].candidates` 与 `evidence/<pageId>/raw/<regionId>.png`。
  - `'covered'`：有效像素被更高分候选完全覆盖，仅保留在 `evidence[].candidates` 与 `evidence/<pageId>/raw/<regionId>.png`。
- `candidate.overlaps`：与当前候选争夺内缩选区像素的更高分先行候选 `regionId` 列表。
- `evidence/<pageId>/fill-preview.png`：在归一化原图上把全部 `'ready'` 选区预填各自估计主色后的整页预览。

用 `ws.emitImage` 检视每页 `preview.png`、`fill-preview.png` 与重点 `crops/<regionId>.png`（零候选页检视 `normalized/<pageId>.png`），逐页完成四项判定：

1. **目标与保留意图**：普通对白框、旁白框、心声框与信件框保持 `'translate'`。海报、招牌、音效字、衣服字，或含复杂网点/图案且纯色覆盖会破坏画面的区域，改为 `disposition: 'preserve'`、`preserveReason: 'intentional'`。`preserve` 只保护该候选自身的互斥选区，若 `candidate.overlaps` 非空，须一并核对相邻重叠候选的去留。
2. **漏检与已知缺口**：原图存在应处理但模型漏检的文字框（如系统消息框）、`empty_selection` 候选或单候选无法完整覆盖的破损区域，新增或改写为 `disposition: 'preserve'`、`preserveReason: 'repair_failed'`（字迹无法辨认时用 `'unreadable'`）、`selection: null`、`direction: null`、`fill: null`，并将可读原文一并记入 `records`。
3. **纯色填充色值**：对照 `fill-preview.png` 检查每个 `'translate'` 区域的 `fill.color`（RGB 三元组）。若文字像素拉偏了主色（如黑底白字或大字号深色字），修改为容器底色对应的准确 `[R, G, B]`。
4. **原文、说话人、方向与阅读顺序**：按漫画自然阅读顺序（日漫通常从右到左、从上到下）排列区域，识别每个待译及可读缺口区域的原文 `message`、可选 `name` 与文字排版方向 `direction`（`'vertical-rl'` 或 `'horizontal-tb'`）。严禁凭空猜测看不清的文字。

# 确认与纯色消字

完成取证判定后，调用 `image.apply` 锁定确认状态，再调用 `image.erase` 生成消字候选页：

```js
import * as image from '@lg/image';

const draft = await image.read('work/image/ch01');
const page = draft.book.pages[0];

const applied = await image.apply('work/image/ch01', draft.revision, {
  confirmed: true,
  pages: [
    {
      ...page,
      regions: [
        {
          regionId: 'r0001',
          disposition: 'translate',
          selection: page.regions[0].selection,
          direction: 'vertical-rl',
          fill: { color: [255, 255, 255] },
        },
        {
          regionId: 'r0002',
          disposition: 'preserve',
          preserveReason: 'intentional',
          selection: page.regions[1].selection,
          direction: null,
          fill: null,
        },
        {
          regionId: 'r0003',
          disposition: 'preserve',
          preserveReason: 'repair_failed',
          selection: null,
          direction: null,
          fill: null,
        },
      ],
    },
  ],
  records: [
    {
      pageId: page.pageId,
      regionId: 'r0001',
      name: '角色A',
      message: '原文台词',
    },
    {
      pageId: page.pageId,
      regionId: 'r0003',
      message: '漏检消息框的可读原文',
    },
  ],
});

const erased = await image.erase({
  workDirectory: 'work/image/ch01',
  expectedRevision: applied.revision,
});
```

- `apply` 校验页面元数据不可变，只接受该区域在当前页已注册的 `selection` 引用（`{ path, sha256 }`）或 `null`，并校验同页非空选区像素互斥。
- **消字门禁与文本解耦**：页面消字输入摘要（`eraseInputDigest`）仅由页面原图摘要及各区域的 `disposition`、`selection` 与 `fill.color` 决定。修改 `records`（原文或说话人）、区域顺序、`direction` 或 `preserveReason` **不会**使已 `reviewed` 的页面失效；只有改动某页的 `disposition`、`selection` 或 `fill.color` 时，该页才需重跑 `erase` 与 `review`。
- `erase` 在归一化原图上对 `'translate'` 选区填充 `fill.color`，输出 `runs/<runId>/<pageId>/clean.png`、`mask-overlay.png` 与 `masks/<regionId>.png`，并按 `v<ALGORITHM_VERSION>-<inputSha256>` 自动复用 `cache/`。某页无 `'translate'` 区域时直接输出无改动底图并校验像素一致。

# 视觉验收

`erase` 仅通过机器门禁保证非掩码区像素零改动，无法发现选区越过气泡黑边或未包住边缘笔画等语义缺陷。必须用 `ws.emitImage` 逐页检视 `erased.pages` 返回的 `overlay`（`runs/<runId>/<pageId>/mask-overlay.png`）与 `clean`（`runs/<runId>/<pageId>/clean.png`）：

- 检查原字笔画是否完全抹除、气泡边框与邻近画稿是否被选区吃掉、填色是否与气泡底色融合。
- 验收通过的页面标记 `decision: 'accept'`；存在色差、残字或破边的页面标记 `decision: 'reject'` 并附上原因。

```js
import * as image from '@lg/image';

const reviewed = await image.review({
  workDirectory: 'work/image/ch01',
  runId: erased.runId,
  expectedRevision: erased.revision,
  pages: [
    { pageId: page.pageId, decision: 'accept' },
  ],
});
```

被 `reject` 的页面：
1. 若为填色偏差，通过 `image.apply` 修正 `fill.color`，再对该页执行 `image.erase({ ..., pageIds: [pageId] })` 与 `image.review`。
2. 若选区吞边或漏掉边缘笔画且无法靠纯色回填安全抹除，通过 `image.apply` 将该区域降级为 `disposition: 'preserve'`、`preserveReason: 'repair_failed'`（保留可读 `records`），再重跑该页 `erase` 与 `review`。

# 打包、导入与更新

全部页面通过 `review` 后，调用 `image.pack` 生成 `.image` 归档包：

```js
import * as image from '@lg/image';

const packed = await image.pack('work/image/ch01', 'work/image/ch01.image');
```

- 首次入库与已有 `.image` 原地更新（`creates.jsonl` / `replaces.jsonl`）统一遵循 `project-operation` 技能。
- 更新工程中已有的 `.image` 时，无需重跑模型或重建 `evidence/`，直接从展开的 `sources/<file_path>` 离线恢复工作目录：

```js
import * as image from '@lg/image';

const restored = await image.restore('sources/ch01.image', 'work/image/ch01');
```

恢复后可直接调用 `image.apply` 修改原文记录、阅读顺序或调整填色/去留，仅对受影响页面重跑 `erase` + `review` 后再次 `pack`，并通过 `replaces.jsonl`（继承已有译文时设 `inheritance_mode: 'inherit'`）提交更新。

# 写回与验证

在 `project-operation` 触发 `generateFiles` 后，宿主在 `<writeback.input_path>/<file_path>/items.json` 生成填入译文的记录数组。

1. **译文与条目核对**：读取 `<writeback.input_path>/<file_path>/items.json` 与 `sources/<file_path>/image.json`，核对记录数与全书 `'translate'` 区域数一致，无漏译、串行或置空。
2. **导出无字底图目录**：通过 `image.restore` 恢复 `.image`（若当前工作目录尚未就绪），再调用 `image.publish` 将已验收的无字底图幂等导出到工作区暂存目录或 `project-operation` 确定的交付目录：

```js
import * as image from '@lg/image';

const restored = await image.restore('sources/ch01.image', 'work/image/ch01');
const published = await image.publish({
  workDirectory: 'work/image/ch01',
  outputDirectory: 'work/image/deliveries',
  expectedRevision: restored.revision,
});
```

- `publish` 在 `outputDirectory` 下创建确定性子目录 `image-<deliverySha256前12位>/`，按页序导出 `0001-<pageId>.png`、`0002-<pageId>.png`… 及 `delivery.json`（含 `bookId`、整包 `status`、`deliverySha256` 与每页的 `pageId`、`originalSha256`、`inputSha256`、`file`、`sha256`、`preserved` 列表）。
- 相同内容重复调用 `publish` 会校验已有文件摘要并直接复用同一目录。
- 按 `project-operation` 的导出与交付流程，将核对后的译文结果与无字底图目录一并交付。

# 交付说明

向用户汇报交付结果时，对照 `clean.json` / `delivery.json` 与 `image.json` 说明以下事项：

|类别|汇报内容|
|---|---|
|交付物与状态|`.image` 归档路径、无字底图目录路径、译文路径，以及整包状态（`complete` 或 `partial`）|
|已知缺口（`partial`）|列出所有 `preserveReason` 为 `'repair_failed'` 或 `'unreadable'` 的页码、`regionId`、原因，以及已附带的可读原文与译文位置|
|有意保留内容|说明按 `'intentional'` 保留或未纳入自动消字的海报、招牌、音效字、衣服字、无框自由字|
|容器整体纯色覆盖|若存在带内部底纹、渐变或半透明背景但按纯色整体覆盖的气泡，说明对应页码与区域|
|零待译区域页面|存在无文字或全保留页面时，说明已人工核对原图确认无遗漏待译容器|
