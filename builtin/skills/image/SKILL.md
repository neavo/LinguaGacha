---
name: image
description: 识别、消字、翻译、审校、修改漫画或图片，或为漫画或图片生成译图与无字底图前必须加载。
---

本技能处理漫画页与带气泡图片的闭合文字容器定位、背景分流、原文与消字方法确认、填色或模型修复、`.image` 归档、分区译文分配、自动排版、视觉验收与成品交付。

- 海报、招牌、音效字、衣服字与无框自由字不纳入自动消字。
- 填色消字会填平选区内部孔洞，用确认色值覆盖选区主体，仅在全部填色选区并集的最外一层像素与原图混合过渡。
- 有框复杂背景使用 `eraseMethod: "inpaint"`：提取暗笔画与邻近白描边，填满内部封闭孔洞，少量外扩后用 LaMa 修复。仅回贴实际掩码内像素。浅色字、漏检或描边残留须通过视觉验收判断，失败区域保留原图并登记 `repair_failed`。

阶段导航：

|阶段入口|章节|
|---|---|
|原稿与条目|「原稿与条目」「应用接口」|
|来源调查|「来源调查」|
|导入准备|「环境准备」「检测与取证」「确认与消字」「消字验收」「打包与更新」|
|写回与验证|「写回与验证」|
|交付说明|「交付说明」|

# 原稿与条目

`.image` 条目的翻译与审校须结合原图视觉翻译，对照 `sources/<file_path>/originals/<pageId>.<ext>`、阅读顺序、文字方向与画面语境核对说话人、语气、指代与断句。

工程中存在两类路径同名但结构与用途不同的 `items.json`，切勿混用：

|位置|内容与用途|
|---|---|
|`sources/<file_path>/image.json`|`ImageBook`：页尺寸、EXIF 方向、原图引用与已确认区域列表 `pages[].regions`|
|`sources/<file_path>/items.json`|原稿条目 `ImageRecord[]`（`{ pageId, regionId, message, name? }`），按全书 `translate` 区域顺序排列，数组下标即项目条目 `row_number`；全书无待译区域时为 `[]`|
|`sources/<file_path>/clean.json`|第一阶段状态（`complete \| partial`）及每页已验收无字底图与生效掩码映射|
|`sources/<file_path>/originals/<pageId>.<ext>`|原始图片字节（PNG 或 JPEG）|
|`sources/<file_path>/clean/<pageId>.png`|EXIF 方向归一化后的已验收无字底图|
|`sources/<file_path>/masks/<pageId>/<regionId>.png`|与归一化页同尺寸的 8-bit 二值 PNG（仅含 `0` 与 `255`），同页非空选区像素两两互斥|
|`sources/<file_path>/erase-masks/<pageId>/<regionId>.png`|仅模型修复区域保存的实际消字掩码，只覆盖气泡选区内部文字；填色直接复用 `masks/` 中的完整选区|
|`<writeback.input_path>/<file_path>/items.json`|`generateFiles` 生成的写字快照 `ImageTextInput`（`{ bookId, sourceSha256, records: [{ pageId, regionId, text }] }`），仅覆盖 `translate` 区域|

`ImageRegion` 字段约束：

|字段|约束|
|---|---|
|`regionId`|页内唯一标识，如 `r0001`|
|`disposition`|`"translate"`（消字并写字）或 `"preserve"`（保留原图像素）|
|`preserveReason`|仅 `"preserve"` 必填：`"intentional"`（确认无需处理，如海报、招牌、音效字）、`"unreadable"`（字迹无法辨认）或 `"repair_failed"`（本应处理但当前无法安全消字：复杂背景、漏检、选区为空或消字破边/残字后降级）|
|`selection`|`{ path, sha256 } \| null`，只接受该区域在当前页已注册的 `masks/<pageId>/<regionId>.png`|
|`direction`|`"vertical-rl" \| "horizontal-tb" \| null`|
|`eraseMethod`|`"fill" \| "inpaint" \| null`，确认后的消字方法|
|`backgroundColor`|`[R, G, B] \| null`，通道值为 `0..255` 整数；用于填色和排版文字颜色判断，模型修复不使用此值重绘背景|

- `confirmed: true` 时，每个 `"translate"` 区域必须具备非空且已注册的 `selection`、`direction`、`eraseMethod`、`backgroundColor`，不得含 `preserveReason`，且在原稿 `items.json` 中有对应非空原文 `message`（`name` 可选，仅作翻译语境元数据，写字时不拼入气泡正文）。
- `"preserve"` 区域不改原图像素，`direction`、`eraseMethod` 与 `backgroundColor` 均为 `null`：已检出候选转保留时保留原 `selection`；模型漏检、`empty_selection` 或无法提供合法掩码的文字容器登记为 `"preserve"` + `"repair_failed"`（或 `"unreadable"`）且 `selection: null`，可读原文一并记入草稿 `records`，使已知缺口进入 `partial` 状态而不伪造掩码。

工作目录 `work/image/<资产名>/` 中，第一阶段维护 `draft.json`、`originals/`、`masks/`、`normalized/`、`evidence/`、`runs/`、`reviewed/`；第二阶段在 `text/plans/`、`text/runs/` 下维护分区候选与自包含运行产物，不改写第一阶段事实。

## 应用接口

从 `@lg/image` 导入：

|入口|用途|
|---|---|
|`IMAGE_DEPENDENCIES`、`missing_models()`、`prepare_models()`|工作区依赖常量，检查并准备 `bubble` 气泡分割、`text` 文字检测与 `inpaint` LaMa 模型|
|`prepare({ sources, workDirectory, device? })`|归档原图、归一化方向、运行气泡分割与背景分流，生成初始草稿（`revision`、`confirmed`、`book`、`records`）与 `evidence`|
|`read(workDirectory)`|读取当前草稿、各页消字验收状态 `reviewStatus`（`[{ pageId, inputSha256, reviewed }]`）与 `evidence`|
|`apply(workDirectory, expectedRevision, { pages, records, confirmed })`|校验修订号与选区约束，原子更新草稿区域、原文记录与确认状态，返回更新后的草稿|
|`erase({ workDirectory, expectedRevision, pageIds? })`|按已确认方法执行整页消字，返回 `{ runId, revision, pages: [{ pageId, clean, overlay }] }`|
|`review({ workDirectory, runId, expectedRevision, pages })`|提交各页消字验收决定（`[{ pageId, decision: 'accept' \| 'reject', reason? }]`），固化通过页并返回 `{ revision, accepted, rejected, unreviewedPages }`|
|`pack(workDirectory, output)`|将全部通过消字验收的工作目录封装为 `.image` 归档，返回 `{ path, status: 'complete' \| 'partial' }`|
|`restore(sourceDirectory, workDirectory)`|从展开的 `sources/<file_path>` 离线恢复工作目录与已验收底图，无需重跑模型|
|`prepare_text({ workDirectory, inputPath, expectedRevision })`|读取写回快照并生成写字计划（`{ planId, pages }`），提供各区域 `C0`..`C6` 分区候选与预览图|
|`render({ workDirectory, planId, assignments?, expectedRevision })`|按所选分区候选与分块译文执行原生排版和门禁检查，返回 `{ renderId, pages }`|
|`publish({ workDirectory, outputDirectory, expectedRevision?, source })`|导出无字底图（`kind: 'clean'`）或经视觉决定的译图成品包（`kind: 'rendered'`），返回 `{ path, status, pages, files }`|

修订冲突时调用 `read()`，根据当前草稿重新判断操作。计划来源变化时重新调用 `prepare_text()`。运行文件缺失或损坏时，清理报错指向的损坏运行目录，再执行对应计算。使用有效运行的 `runId` 或 `renderId` 继续验收与发布。

# 来源调查

1. 扫描输入路径，筛选静态不透明图片（`.png`、`.jpg`、`.jpeg`）。含透明通道、动图或损坏文件直接排除并记录原因。
2. 游戏目录内的立绘、UI 与贴图优先归属对应游戏引擎技能，不拆出按独立漫画导入。
3. 同一话、同一卷或同一批次页面按自然页序封装为一个 `.image` 包；单张独立插图按单文件一个 `.image` 包组织，分包与路径规则遵循 `project-operation`。

# 环境准备

`image.prepare` 启动气泡分割与文字检测。`erase` 在页面含 `inpaint` 区域时重新检测文字并以 CPU 执行 LaMa；纯填色、打包与写字材料生成无需推理模型。`render` 同时使用桌面 Chromium 宿主。

首次运行图片计算前，在 `workspace_run` 中安装依赖（调用 `image.prepare` 前一并准备模型）：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
import * as image from '@lg/image';

await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
if (image.missing_models().length > 0) await image.prepare_models();
```

# 检测与取证

调用 `image.prepare` 完成原图归档、EXIF 方向归一化、实例分割、内缩互斥选区、文字检测、背景分流与取证图生成（已有工作目录用 `image.read` 读取）：

```js
import * as image from '@lg/image';

const prepared = await image.prepare({
  sources: ['uploads/page-001.jpg', 'uploads/page-002.jpg'],
  workDirectory: 'work/image/ch01',
  device: 'cpu',
});
```

`prepare` 对每个候选闭合容器填平内部孔洞并内缩轮廓，按置信度从高到低分配互斥像素归属。随后从每个选区排除整页文字检测框 `evidence[].textBoxes`，用剩余背景像素估计底色并给出分流建议，在 `evidence` 中返回每页的 `preview`、`fillPreview`、`crops`、`textBoxes` 与 `candidates`：

- `candidate.status === 'ready'`：拥有非空互斥选区，进入初始 `book.pages[].regions`（`confirmed: false`）。`candidate.color` 是背景样本估计的 RGB 底色，背景样本为空时缺省。`candidate.background` 记录分流建议：
  - `route: 'fill'`：接近底色的像素占比 `coverage` 不低于 80%，初始为 `disposition: 'translate'`、`eraseMethod: 'fill'`，以 `candidate.color` 作为 `backgroundColor`。
  - `route: 'model'`：底色占比不足或背景样本为空（`coverage: null`），初始为 `disposition: 'translate'`、`eraseMethod: 'inpaint'`，原文待填写。`backgroundColor` 使用估计底色，缺省时需结合原图补齐；它只用于该区域后续排版的颜色判断。
  - `samplePixels` 是排除文字框后的背景样本像素数，样本过少时底色与分流都不可靠。
- `candidate.status === 'empty_selection' | 'covered'`：内缩后为空或被更高分候选完全覆盖，仅保留在 `evidence[].candidates` 与 `evidence/<pageId>/raw/<regionId>.png`。`candidate.overlaps` 列出争夺像素的更高分先行候选 `regionId`。
- 每页取证图：`evidence/<pageId>/preview.png` 绘制橙色原始轮廓、绿色内缩选区轮廓与 `regionId`；`crops/<regionId>.png` 是候选裁片；`fill-preview.png` 只预览填色区域，与 `erase` 使用同一填色算法；模型修复效果在执行 `erase` 后查看。

用 `ws.emitImage` 检视每页 `preview.png`、`fill-preview.png` 与重点 `crops/<regionId>.png`（零候选页结合 `textBoxes` 检视 `normalized/<pageId>.png`），逐页完成四项判定：

1. **去留与分流复核**：`route` 只是建议，以确认后的 `disposition` 与 `eraseMethod` 为准。
   - 纯色背景的对白、旁白、心声与信件容器使用 `'translate'` + `eraseMethod: 'fill'`，确认 `backgroundColor`、`direction` 与 `records` 原文。
   - 透明气泡、网点、渐变或图案背景使用 `'translate'` + `eraseMethod: 'inpaint'`。确认选区只属于该容器；混入无框文字或只剩重叠边缘的候选不能直接作为独立修复区域。
   - 海报、招牌、音效字、衣服字等确认无需处理的内容改为 `'preserve'` + `'intentional'`。`'intentional'` 会让该区域不计入未完成缺口，未处理的待译文字不得使用。
   - `preserve` 只保护该候选自身的互斥选区，若 `candidate.overlaps` 非空，须一并核对相邻重叠候选的去留。
2. **漏检与已知缺口**：原图应处理但模型漏检的文字框、`empty_selection` 候选或单候选无法完整覆盖的破损区域，新增或改写为 `disposition: 'preserve'`、`preserveReason: 'repair_failed'`（字迹无法辨认时用 `'unreadable'`）、`selection: null`、`direction: null`、`eraseMethod: null`、`backgroundColor: null`。
3. **背景色**：填色区域对照原图与 `fill-preview.png` 确认 `backgroundColor`，保留暖白、浅灰等真实底色；模型修复区域填写正文所在背景的代表色，供排版判断文字颜色。
4. **原文、说话人、方向与阅读顺序**：按漫画自然阅读顺序（日漫通常从右到左、从上到下）排列 `page.regions` 与 `records`，填写每个待译区域的原文 `message`、可选 `name` 与文字方向 `direction`（`'vertical-rl'` 或 `'horizontal-tb'`），保留区域的可读原文也记入 `records`。严禁猜测看不清的文字。

# 确认与消字

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
          eraseMethod: 'fill',
          backgroundColor: [255, 255, 255],
        },
        {
          regionId: 'r0002',
          disposition: 'preserve',
          preserveReason: 'intentional',
          selection: page.regions[1].selection,
          direction: null,
          eraseMethod: null,
          backgroundColor: null,
        },
        {
          regionId: 'r0003',
          disposition: 'preserve',
          preserveReason: 'repair_failed',
          selection: null,
          direction: null,
          eraseMethod: null,
          backgroundColor: null,
        },
      ],
    },
  ],
  records: [
    { pageId: page.pageId, regionId: 'r0001', name: '角色A', message: '原文台词' },
    { pageId: page.pageId, regionId: 'r0003', message: '漏检消息框的可读原文' },
  ],
});

const erased = await image.erase({
  workDirectory: 'work/image/ch01',
  expectedRevision: applied.revision,
});
```

- **消字与文本解耦**：单页消字摘要由原图、`disposition`、`selection`、`eraseMethod` 和填色区域的 `backgroundColor` 决定。修改原文、阅读顺序、方向、保留原因或模型修复区域的背景代表色，不撤销已有消字验收；像素输入变化后才需重跑该页 `erase` 与 `review`。

模型修复在 `erase` 中按需生成笔画掩码，填满封闭内部孔洞，保留外轮廓凹陷与开放字间空隙，再少量外扩并限制在气泡选区内。各区域均从同一原图取上下文；程序只回贴最终掩码内像素。实际掩码随运行与验收产物保存，不能替代排版的 `selection`。无文字检测结果或掩码为空时会携带区域身份报错，确认是漏检则按未完成区域处理。

# 消字验收

机器门禁仅保证非掩码区像素零改动，无法发现选区吞噬气泡黑边或漏掉边缘笔画。必须用 `ws.emitImage` 逐页检视 `erased.pages` 返回的 `overlay` 与 `clean`。`overlay` 标出实际消字掩码范围；填色区域的最外一层像素混合属于预期过渡，模型修复区域须另行检查描边与细笔画是否完整消除：

- 确认原字笔画已抹除、气泡边框与邻近画稿完好、填色与气泡底色自然融合后，调用 `image.review` 提交 `decision: 'accept'`。紧贴边框的零星微小残点可以接受，边框完整优先。
- 存在明显色差、成段残字、破边或纹理被抹平的页面提交 `decision: 'reject'` 并附 `reason`。
- 被 `reject` 的页面：填色偏差可修正 `backgroundColor`；有框纹理不适合填色可改为 `eraseMethod: 'inpaint'`，再重跑该页。若存在漏字、破边、错误归属或修复效果仍不可接受，改为 `'preserve'` + `'repair_failed'`，将方向、方法、背景色置空，保留可读原文，再重跑与验收。技术失败或取消按错误恢复执行条件，不将未完成运行当作成功。

# 打包与更新

全部页面通过 `review` 后调用 `image.pack('work/image/ch01', 'work/image/ch01.image')` 生成归档包，按 `project-operation` 首次导入或通过 `replaces.jsonl`（设 `inheritance_mode: 'inherit'`）原地更新。

封包失败后按错误修正输入或恢复执行条件，再调用 `image.pack`。相同条件下的确定性失败保留工作目录并报告阻塞，不根据私有实现自行拼包。

修改工程中已有的 `.image` 时，无需重跑模型或重建 `evidence/`，直接从展开的 `sources/<file_path>` 离线恢复工作目录：

```js
import * as image from '@lg/image';

const draft = await image.restore('sources/ch01.image', 'work/image/ch01');
```

# 写回与验证

在 `project-operation` 的「导出与交付」中，先提交所需译文变更，再调用 `generateFiles(bilingual_files)` 取得 `<writeback.input_path>/<file_path>/items.json`（`ImageTextInput` 快照）。其中：

- `text: null`：尚无可用完成译文，区域状态记为 `'untranslated'`，不会回填原文冒充译文。
- `text: ""` 或纯空白：完成态显式空正文，区域状态记为 `'blank'`，保持无字。
- 非空 `text`：本次要排版的译文（同文译文同样有效）。

写字与验证按以下步骤闭环执行：

1. **准备计划（`prepare_text`）**：从 `sources/<file_path>` 恢复或确认工作目录后调用 `image.prepare_text`。程序校验草稿修订、已验收底图与来源摘要，对每条非空译文执行一次规范化（合并普通单换行、保留空行段落间隔），并在返回的 `plan.pages[].regions[]` 中为每个 `'translate'` 区域提供：
   - `sourceText`（完整原文）与规范化后的 `text`（待排译文）。
   - `candidates`：始终含整体方案 `C0`（单块 `B1`），以及最多 6 个二分候选 `C1`..`C6`（双块 `B1`、`B2`，按竖排从右到左、横排从上到下给出默认顺序）。每个候选带 `preview` 路径，每个块带像素面积占比提示 `areaShare`（`0..1`）与包围盒 `box`。
   - `recommendedCandidateId`：存在合格拆分候选时为 `'C1'`，否则为 `'C0'`。
2. **查看候选与分配译文（`assignments`）**：用 `ws.emitImage` 查看页面 `originalPreview` 与多候选区域的候选 `preview`（标注候选编号与 `B1`/`B2` 色块），结合完整原文、译文与画面确定方案：
   - **分区判断**：分区仅属写字几何材料，不改动 `.image` 原稿与工程条目。**分界切过原图字迹不是拒绝条件**；连续句子可以跨块延续，单块无需独立成句。连通双气泡优先采用拆分方案；若普通单气泡被切碎，显式改选 `'C0'`。`block.areaShare` 仅提示像素面积占比，避免把长句塞入细小主体，不要按面积比例机械截取字数。
   - **单块与省略规则**：单块方案（`C0`）或 `region.text` 为 `null`/`""` 时无需提供 `blocks`，程序自动填入完整 `region.text`；当 `recommendedCandidateId` 为多块但决定改用整体方案时，传入 `{ pageId, regionId, candidateId: 'C0' }` 即可。
   - **多块分配与文字守恒**：所选方案含多个块且 `region.text` 非空时，必须提交 `{ pageId, regionId, candidateId, blocks: [{ blockId, text }, ...] }`。`blocks` 数组顺序即实际阅读顺序（画面阅读顺序与默认相反时直接交换数组中 `B1`、`B2` 的位置）。按数组顺序拼接 `blocks.map(b => b.text).join('')` **必须逐字符等于 `plan` 中的 `region.text`**：
     - 严禁在分配中改写、增删或润色译文，也严禁对单块分别 `.trim()`。
     - 跨块边界处的空格、标点与空行段落必须归入某一块，且分界不得拆开同一个字素簇（如组合音标或 emoji 序列）。
     - 所选候选的每个 `blockId` 必须且只能出现一次；某块确需留空时传 `text: ""`（块状态为 `'blank'`，总文本仍须守恒）。
3. **自动排版与整页视觉验收（`render`）**：调用 `image.render` 执行原生 Chromium 排版与像素复核。返回值中每页 `status` 为 `'ready' | 'incomplete' | 'error'`，每个块状态为 `'rendered'`（含 `fontSize`、`warnings`）、`'blank'`、`'untranslated'` 或 `'failed'`（含 `reason: 'no_fit' | 'missing_glyph'` 及缺字列表 `missing`）。`page.status === 'ready'` 仅代表全部块通过边距、居中、字形覆盖与跨行碰撞门禁，**不等于视觉接受**。必须用 `ws.emitImage` 逐页查看 `page.preview`（大图或 `warnings` 含 `'small_font'` 的区域结合裁图放大核实，不凭缩略图直接放行细字），核对文字完整、跨块顺序自然、字号均衡与画面协调。`'small_font'`（字号 `<8px`）仅提醒核验可读性，无需向用户额外提问。
4. **问题恢复分流**：

|观察到的问题|恢复方式|
|---|---|
|多块分配失衡、阅读顺序颠倒、分块后某块 `no_fit` 或字号过小|保持同一 `planId`，调整该区域的 `candidateId`（如切换 `C1`/`C2`/`C0`）、`blocks` 顺序或断句切点，重新调用 `image.render`（沿用已验收底图，每次调用重新计算写字结果）|
|单块 `no_fit`，或译文过长需精简表达|通过 `workspace_apply` 修订工程条目译文（保持原意，不得静默删减关键内容），再重新执行 `generateFiles → prepare_text → render`|
|区域状态为 `'untranslated'`（`text: null`）|完成对应工程条目的翻译并提交后，重新执行 `generateFiles → prepare_text → render`|
|块状态为 `'failed'` 且 `reason: 'missing_glyph'`|检查 `missing` 字符；属异常符号时修正条目译文后重跑，属字体无法覆盖的生僻字时保留失败记录并在交付时说明|
|底图存在残字、气泡破边或填色色差|回到第一阶段执行 `apply → erase → review → pack` 并通过 `replaces.jsonl` 更新工程资产，严禁在写字阶段掩盖底图问题|

5. **原子发布（`publish`）**：逐页整理视觉决定 `decisions`（仅 `status === 'ready'` 的页面可设 `decision: 'accept'`；拒绝页设 `decision: 'reject'` 并填写非空 `reason`；零待译区域页面在未显式拒绝时自动沿用第一阶段底图验收），调用 `image.publish`：

```js
import * as image from '@lg/image';

const workDirectory = 'work/image/ch01';
const draft = await image.restore('sources/ch01.image', workDirectory);
const plan = await image.prepare_text({
  workDirectory,
  inputPath: `${writeback.input_path}/ch01.image/items.json`,
  expectedRevision: draft.revision,
});

// 查看 plan.pages 的 originalPreview 与多候选 preview 后填写多块分配或 C0 覆盖：
const assignments = [
  {
    pageId: plan.pages[0].pageId,
    regionId: 'r0001',
    candidateId: 'C1',
    blocks: [
      { blockId: 'B1', text: '前半句台词，' },
      { blockId: 'B2', text: '后半句台词！' },
    ],
  },
];

const rendered = await image.render({
  workDirectory,
  planId: plan.planId,
  assignments,
  expectedRevision: draft.revision,
});

// 逐页用 ws.emitImage 检查 rendered.pages[].preview 后提交视觉决定：
const decisions = [
  { pageId: rendered.pages[0].pageId, decision: 'accept' },
];

const published = await image.publish({
  workDirectory,
  outputDirectory: 'work/image/deliveries',
  expectedRevision: draft.revision,
  source: {
    kind: 'rendered',
    renderId: rendered.renderId,
    decisions,
  },
});
```

- 仅需导出第一阶段无字底图时，调用 `image.publish({ workDirectory, outputDirectory, expectedRevision, source: { kind: 'clean' } })`。
- `published.path` 为实际生成的 `<outputDirectory>/image-<deliverySha256>/`：
  - `delivery.json`：记录整包 `status`（全部页面均被接受且第一阶段 `clean.status === 'complete'` 时为 `'complete'`，否则为 `'partial'`）、`source`、`environment`、每页状态与文件摘要。
  - `pages/0001-<pageId>.png`：仅含计算 `'ready'` 且视觉 `'accept'` 的正式成品页（保留全书原始页序编号，缺页不重排掩盖）。
  - `incomplete/0002-<pageId>/`：未译、排版失败、宿主异常、视觉拒绝或未验收（`'not_reviewed'`）页面的 `clean.png`、`result.json` 与可选诊断 `preview.png`。
  - `input.json`、`selected.json`、`render.json`、`masks/`：自包含的本次写字运行材料。
- 按 `project-operation` 的「导出与交付」将成果交付到目标位置，切勿把 `incomplete/` 中的诊断预览混入正式成品页。

# 交付说明

向用户汇报交付结果时，对照 `delivery.json`、`clean.json` 与 `image.json` 说明以下事项：

|类别|汇报内容|
|---|---|
|交付物与状态|`.image` 归档、图片交付目录（`published.path`）及整包状态（`complete` 或 `partial`）|
|写字阶段缺口（如有）|列出进入 `incomplete/` 的页码、`regionId`/`blockId`、具体原因（`untranslated`、`no_fit`、`missing_glyph`、宿主错误、视觉 `reject` 原因或 `not_reviewed`）及已保留的底图与诊断材料|
|消字阶段缺口（如有）|列出 `preserveReason` 为 `'repair_failed'` 或 `'unreadable'` 的页码、`regionId`、原因（背景修复未通过、漏检、破边或残字降级、字迹无法辨认），以及工程中已附带的可读原文与译文|
|小字号提示（如有）|说明含 `'small_font'`（字号 `<8px`）但经视觉确认可读的页码与区域|
|有意保留与特殊处理|说明按 `'intentional'` 保留的海报、招牌、音效字、衣服字等区域，以及带浅底纹但经确认按填色覆盖的气泡页码与区域；存在零待译区域页面时说明已人工核对原图确认无遗漏|
