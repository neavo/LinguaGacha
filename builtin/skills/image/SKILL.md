---
name: image
description: 导入、分析、翻译、审校、修改或导出独立图片、漫画、插画及 `.image` 资产前必须加载。
---

# 图片与漫画处理

`@lg/image` 负责候选检测、背景抹字、译文排版、合成预览与成图发布。`.image` 资产保存原图与确认后的区域和编辑组结构，工程 `items` 数据集独占译文 `dst` 与完成状态 `status`（唯一事实来源）。

阶段导航：除「导入准备」按「环境准备 → 候选检测、补漏与原文核对 → 编辑组、保护区、掩码与抹字模式 → 草稿提交、打包与导入替换」展开外，其余入口直接对应同名二级章节。

阶段例外：

- **看图确认时可一并拟译**：导入准备中看图确认区域与阅读顺序时，若用户未要求仅导入不翻译，可直接形成初稿译文。先提交 `.image` 入库，再通过 `changes/items/updates.jsonl` 写入工程条目，不在 `.image` 或工作草稿中保存第二份译文。
- **看图翻译**：处理 `IMAGE` 条目时，结合整页或局部原图语境与气泡版面空间由 Agent 直接执行，不使用纯文本 `batch_item_translation`。

---

## 来源调查

- **适用材料**：独立图片目录、单张漫画或插画（静态、完全不透明 PNG 或 JPEG，单页像素不超过 `100_000_000`，动图或含透明通道将被拒绝）以及 `.image` 包（`file_type: "IMAGE"`）。
- **游戏资源边界**：属于游戏引擎目录内的贴图或 CG，先由对应引擎技能判定归属，不擅自拆作 `.image` 重复导入。
- **组织与零文本页**：按话、卷或阅读批次封装为一个 `.image`，或单图独立成包，按文件名与页码自然排序。无待译文字的封面或纯插画页保留在 `book.pages`，对应 `regions` 与 `groups` 置空（全书 0 条记录有效）。

---

## 导入准备

每份 `.image` 资产使用工作区下的独立工作目录，例如 `work/image/<资产名>/`。

### 环境准备

`@lg/image` 不自动安装依赖，任务开始前按需补齐并下载模型：

1. **JS 依赖（`@lg/npm`）**：安装 `onnxruntime-node@${INFERENCE_DEPENDENCIES.ort}`（使用 `--save-exact`）。忽略 npm 拦截安装脚本的警告，不执行 `install-scripts approve`。
2. **Python 依赖（`@lg/uv`）**：添加 `numpy==${INFERENCE_DEPENDENCIES.numpy}` 与 `opencv-python-headless==${INFERENCE_DEPENDENCIES.opencv}`。声明已存在而 `.venv` 缺失时执行 `uv.run(['sync', '--inexact'])`。
3. **模型准备**：调用 `prepare` 或 `execute` 前先执行 `await prepare_models()` 下载或校验候选检测与背景修复模型。
4. **设备基线**：当前仅完成 `device: "cpu"` 验收，所有 `prepare` 与 `execute` 均传 `"cpu"`。

### 候选检测、补漏与原文核对

1. **生成候选**：调用 `prepare({ sources, workDirectory, device: 'cpu' })`（目标目录已有 `draft.json` 时会拒绝，重跑须更换目录）。
2. **分批看图**：按页分批调用 `ws.emitImage(pageResult.result.preview)` 核对候选编号，遵守单次调用图片数与字节额度。
3. **候选仅供辅助**：`prepare` 只提供 ShadowB 候选，不得未核对直接全量套用。`kind === "frame"` 为分镜框线，只作阅读顺序与边界避让参考，不得作为抹字文本区域。
4. **主动补漏**：补充漏检的框外手写拟声词、低对比度旁白、标题、看板文字和嵌网点小字。
5. **阅读顺序**：按作品排版方向（日漫通常分镜与气泡自右向左、自上而下，条漫与西式漫画自上而下或自左向右）编排每页 `regions` 与 `records`，且 `records` 页序须与 `book.pages` 一致。
6. **疑读原寸裁图**：遇到 `uncertain === true`、竖排小字、草书、高光或网点遮挡时，按原图坐标从 `page.original` 裁出目标框与少量周边语境，通过 `ws.emitImage(cropPath, { maxEdge: 3840 })` 放大确认后再定稿原文。仍看不清时停下并如实报告位置与缺口，禁止猜测拼凑。

### 编辑组、保护区、掩码与抹字模式

#### 编辑组（`ImageGroup`）

- **同底或联动入一组**：共享同一物理擦除底色或位置贴合的多片文字放入同一个 `group`（`regionIds` 列出归属区域）。组内任一区域失败或 `publish` 选 `"preserve"` 时整组恢复原图。
- **独立气泡尽量拆组**：互不重叠的气泡各自成组，避免单个异常波及全页。
- **严禁组间掩码重叠**：各组最终抹除掩码像素不可重叠。发现邻近重叠时收窄区域、用 `protection` 隔离或合并为同一组。

#### 擦除模式选择

|模式|适用场景|机制与边界|
|---|---|---|
|`solid`|纯白、纯灰阶闭合气泡（含轻微 JPG 噪点或描边微断）|在 `2x` 搜索框内放宽浅灰阈值并做闭运算修补微缝后填充，填色面积不可超过提示区 `6` 倍，闭合轮廓穿出搜索边界会失败|
|`basic`|彩色纯色底、较大均匀纯色块且边缘严丝合缝的闭合区域|在 `1x` 搜索框按 Lab 色差寻找均匀纯色连通域并内缩，无 `6` 倍面积上限，遇到描边破口或渐变更易穿出搜索边界|
|`inpaint`|网点、渐变、风景/人物背景、跨框线文本或真敞开区域|按最长边 2048px 缩放运行 LaMa 修补，务必用 `protection` 保护人物线条、分镜框线与保留字迹|
|`preserve`|刻意保留原图、不擦除也不贴字|允许 `areas: []` 且不设 `mask`|

#### 保护区、`group.mask` 与几何边界

- **保护区 `protection`**：同时从该组**抹除掩码**和**译文排版区 `layout`** 中扣减像素，靠近线条、网点或留白发丝时优先划出。
- **自定义二值掩码 `group.mask`**：倾斜手写字、复杂尾巴或须绕开前景遮挡时，在 `<workDirectory>/masks/<name>.png` 生成与标准化原图同尺寸（`page.width × page.height`）的 8 位灰度二值 PNG（像素仅含 `0` 与 `255`），并设置 `group.mask = { path: "masks/<name>.png", sha256 }`。
- **提示与掩码边界**：`solid` 与 `basic` 仅遍历 `group.areas` 构造背景采样提示，再与 `areas ∪ mask - protection` 取交。使用这两种模式时，`group.areas` 至少须包含一个贴字多边形（不可只留 `areas: []` 配 `group.mask`）。`inpaint` 可单独配 `group.mask` 与空 `areas: []`。
- **画布坐标边界**：`source` 与所有多边形顶点坐标必须严格截断在 `[0, page.width] × [0, page.height]` 内，且每个多边形至少 3 个顶点、有向面积绝对值不小于 `1`。靠边气泡外扩时务必钳位，防止越界失败。

#### 区域配置与 ID 稳定规则

- **处置类型 `disposition`**：
  - `"translate"`：待译区域，须至少有 1 个 `layout` 多边形、恰归属 1 个组并在 `records` 中按顺序对应唯一 `{ pageId, regionId, message, name? }`。
  - `"preserve"`：仅作保留定位的区域，不得写入 `records`。
- **测字与样式**：
  - `source[0]` 用于原生字号估算，必须紧贴原文笔画外缘。
  - `direction`：竖排气泡选 `"vertical-rl"`，横排标题、看板或条漫选 `"horizontal-tb"`。
  - `style`：默认省略 `fontSize`，由程序按 `source[0]` 测量值与布局自动缩放字号，仅在预览核查需要强行固定字号时显式指定 `fontSize`。无纯色底衬的框外字配置高对比 `stroke` 与适当 `strokeWidth`（`0–32`）。
- **ID 稳定规则**：调整坐标、掩码、样式或重排页序时保留原有 `pageId` 与 `regionId`，使后续 `replaces` 能精确保留已完成译文。将区域一拆多或多合一时必须生成新的 `regionId`。

### 草稿提交、打包与导入替换

1. 调用 `apply(workDirectory, revision, { pages, records, confirmed })` 时传入完整 `pages` 与 `records`。核对全部结构、顺序与原文后设 `confirmed: true`。
2. 调用 `pack(workDirectory, 'work/<资产名>.image')` 生成并校验 `.image` 包。
3. 首次入库按 `project-operation` 写 `changes/files/creates.jsonl` 提交。如需修改区域、原文、掩码或样式，重新 `apply` + `pack` 后写 `changes/files/replaces.jsonl`（`inheritance_mode: "inherit"`）就地替换，并核对回执中的 `preserved`、`inherited` 与 `contested`。

---

## 原稿与条目

- **工程原稿与恢复**：已入库 `.image` 展开在 `sources/<file_path>/`。调用 `await restore('sources/<file_path>', workDirectory)` 可从工程快照重建或覆盖同步 `workDirectory` 内的 `draft.json`、原图与掩码（工作缓存可随时丢弃重建）。
- **看图纠偏**：若处理 `IMAGE` 条目时发现原文误读或区域划分不合理，先修订草稿打包并通过 `files.replaces` 更新工程原稿，再修正对应条目 `dst`。

---

## 可见文本补漏

- 工程快照中存在因过滤规则跳过或未译的既有条目时，按 `translation` 的「可见文本补漏」流程收集并判定。
- 若复核时确认有导入阶段遗漏的图面文字尚未入库，再用 `restore` 拉起草稿、补充 `"translate"` 区域（生成新 `regionId`）与 `records`、打包并通过 `files.replaces`（`inheritance_mode: "inherit"`）就地替换，再完成新增条目翻译。

---

## 翻译后检查

正式发布前如需排查长译文溢出气泡或相邻组碰撞风险，先把待检验条目提交为 `PROCESSED`，再执行一轮 `generateFiles([])` + `execute`，结合预览图与 `ready` 状态提前调整译文 `dst`、`layout` 或 `style`。

---

## 写回与验证

1. **生成写回快照**：提交全部待写入的工程条目变更后，调用 `@lg/project` 的 `generateFiles([])`（图片不传入 `bilingual_files`）。对每个 `writeback.files` 中的 `.image` 资产，取 `path.join(writeback.input_path, file_path)` 作为 `writebackDirectory`（禁止跳过 `generateFiles` 或手工拼装完成清单）。
2. **同步并执行排版**：工程快照曾变更或不确定本地工作草稿是否最新时，先调用 `await restore('sources/' + file_path, workDirectory)` 同步。随后调用：
   `const draft = await execute({ workDirectory, writebackDirectory, device: 'cpu' })`
3. **程序边界与排查**：`group.ready === true` 只证明程序侧擦除与排版检查通过，不代表视觉与语义验收通过。常见失败 `reason` 定位：
   - `incomplete_text`：对应条目在工程中 `status !== "PROCESSED"`，提交译文后重新 `generateFiles([])` + `execute`。
   - `needs_layout` / `text_collision`：译文超出布局区或文字冲突，缩短 `dst` 或调整 `layout`、`direction`、`fontSize` 后重新 `pack` + `replaces`。
   - 擦除轮廓或覆盖类失败（如穿出搜索边界、面积超限或未覆盖文字）：按擦除模式边界收整 `areas`、补充 `masks/*.png`、增划 `protection` 或切换为 `inpaint`。
   - `preserve`：该组配置为 `mode: "preserve"`。
4. **视觉与语义逐页复核**：按页调用 `ws.emitImage(page.preview)` 检查渲染成图（疑点做局部裁图放大），确认原文墨迹无残留、线条与网点未抹花、译文字号换行自然且符合分镜语境。
5. **最多两轮人工纠偏**：初轮发现问题时，调整工程 `dst` 或重打包替换后重跑 `generateFiles([])` + `execute`。**初轮之后最多执行两轮纠偏**，两轮后仍未 `ready` 或画面效果损坏的组，不再强行套字，发布时设为 `"preserve"`。
6. **提交发布决策**：按 `project-operation` 的「导出与交付」用 `getOutputPaths` 确定最终父目录后，调用 `publish({ workDirectory, executionId, outputDirectory, reviews })`：
   - `reviews` 必须覆盖 `execution.pages` 中的每一个组（`{ pageId, groupId, decision: "accept" | "preserve" }`）。
   - 仅当 `ready === true` 且通过视觉语义复核时才可传 `"accept"`。
   - 完整交付目录以 `publish` 返回的 `path` 为准，内含按页序生成的 PNG 及 `delivery.json`。

---

## 交付说明

- 汇报最终交付 `status`（全部含待译区域的组均采纳时为 `"complete"`，含任意设为保留原图的待译组时为 `"partial"`，完整清单见 `delivery.json`）、总页数及各页成图结果。
- 明确列出所有最终设为保留原图（`"preserve"`）的待译组位置与原因，不隐瞒局部失败。
- 以 `publish` 返回的 `path` 提供 Markdown 目录链接（正斜线，按路径段编码）。

---

## `@lg/image` 接口速查

```ts
import {
  INFERENCE_DEPENDENCIES, // { ort, numpy, opencv }
  prepare_models,         // () => Promise<void>
  prepare,                // ({ sources, workDirectory, device }) => Promise<Draft & { candidates }>
  read,                   // (workDirectory) => Promise<Draft>
  apply,                  // (workDirectory, expectedRevision, { pages, records, confirmed }) => Promise<Draft>
  pack,                   // (workDirectory, outputZipPath) => Promise<{ path, sourceSha256 }>
  restore,                // (sourceDirectory, workDirectory) => Promise<Draft>
  execute,                // ({ workDirectory, writebackDirectory, device }) => Promise<{ executionId, generationId, status: 'draft', pages }>
  publish,                // ({ workDirectory, executionId, outputDirectory, reviews }) => Promise<{ path, executionId, inputSha256, status?, pages?, groups?, ... }>（同快照重试返回精简回执，完整清单见 path/delivery.json）
} from '@lg/image';
```

---

## 固定示例

以下示例均基于 `device: 'cpu'`，可在 `workspace_run` 中按阶段组合执行：

### 1. 环境准备、模型拉取与候选检测

```js
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
import { INFERENCE_DEPENDENCIES, prepare_models, prepare } from '@lg/image';

await npm.run(['install', '--save-exact', `onnxruntime-node@${INFERENCE_DEPENDENCIES.ort}`]);
await uv.run([
  'add',
  `numpy==${INFERENCE_DEPENDENCIES.numpy}`,
  `opencv-python-headless==${INFERENCE_DEPENDENCIES.opencv}`,
]);
await prepare_models();

const sourceDir = 'D:/manga/ch01';
const sources = (await readdir(sourceDir))
  .filter((name) => /\.(png|jpe?g)$/iu.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((name) => path.join(sourceDir, name));

const draft = await prepare({
  sources,
  workDirectory: 'work/image/ch01',
  device: 'cpu',
});

for (const page of draft.candidates) {
  await ws.emitImage(page.result.preview);
}
```

### 2. 疑读原寸裁图查看（Unicode 路径安全）

```js
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { uv } from '@lg/uv';
import { read } from '@lg/image';

const workDir = 'work/image/ch01';
const draft = await read(workDir);
const page = draft.book.pages[0];
const srcFile = path.resolve(workDir, page.original);
const cropFile = path.resolve(workDir, 'crop-p0-r0.png');
await mkdir(path.dirname(cropFile), { recursive: true });

// box 来自候选坐标，加边距后在 Python 内按图像实际边界截断
const script = `
import sys, pathlib, cv2, numpy as np
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
x, y, w, h = [int(float(v)) for v in sys.argv[3:7]]
img = cv2.imdecode(np.fromfile(str(src), np.uint8), cv2.IMREAD_COLOR)
ih, iw = img.shape[:2]
pad = 24
x0, y0 = max(0, x - pad), max(0, y - pad)
x1, y1 = min(iw, x + w + pad), min(ih, y + h + pad)
ok, buf = cv2.imencode('.png', img[y0:y1, x0:x1])
assert ok
dst.write_bytes(buf.tobytes())
`;
await uv.run(['run', 'python', '-c', script, srcFile, cropFile, '120', '200', '90', '260']);
await ws.emitImage(cropFile, { maxEdge: 3840 });
```

### 3. 生成自定义二值掩码、确认结构并打包

```js
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { uv } from '@lg/uv';
import { read, apply, pack } from '@lg/image';

const workDir = 'work/image/ch01';
const draft = await read(workDir);
const page = draft.book.pages[0];
const box = (x0, y0, x1, y1) => [
  { x: Math.max(0, x0), y: Math.max(0, y0) },
  { x: Math.min(page.width, x1), y: Math.max(0, y0) },
  { x: Math.min(page.width, x1), y: Math.min(page.height, y1) },
  { x: Math.max(0, x0), y: Math.min(page.height, y1) },
];

// 可选：为不规则手写 SFX（inpaint）创建原尺寸二值 [0, 255] 掩码
const maskRel = 'masks/p1-sfx.png';
const maskAbs = path.resolve(workDir, maskRel);
await mkdir(path.dirname(maskAbs), { recursive: true });
const mkMask = `
import sys, pathlib, cv2, numpy as np
w, h, dst = int(sys.argv[1]), int(sys.argv[2]), pathlib.Path(sys.argv[3])
m = np.zeros((h, w), np.uint8)
cv2.fillPoly(m, [np.array([[100, 100], [220, 95], [230, 260], [105, 255]], np.int32)], 255)
ok, buf = cv2.imencode('.png', m)
assert ok
dst.write_bytes(buf.tobytes())
`;
await uv.run(['run', 'python', '-c', mkMask, String(page.width), String(page.height), maskAbs]);
const maskSha256 = createHash('sha256').update(await readFile(maskAbs)).digest('hex');

const baseStyle = { color: '#000000', stroke: '#ffffff', strokeWidth: 0, weight: 400, rotation: 0, minFontSize: 12 };
const pages = structuredClone(draft.book.pages);
pages[0] = {
  ...page,
  regions: [
    {
      regionId: 'r_bubble_1',
      disposition: 'translate',
      source: [{ x: 420, y: 120, width: 85, height: 220 }],
      layout: [box(410, 110, 515, 350)],
      direction: 'vertical-rl',
      style: baseStyle,
    },
    {
      regionId: 'r_sfx_1',
      disposition: 'translate',
      source: [{ x: 110, y: 105, width: 110, height: 145 }],
      layout: [box(100, 100, 225, 255)],
      direction: 'horizontal-tb',
      style: { ...baseStyle, color: '#111111', strokeWidth: 4, weight: 700, rotation: -8, minFontSize: 14 },
    },
  ],
  groups: [
    { groupId: 'g_bubble_1', regionIds: ['r_bubble_1'], mode: 'solid', areas: [box(405, 105, 520, 355)], protection: [] },
    { groupId: 'g_sfx_1', regionIds: ['r_sfx_1'], mode: 'inpaint', areas: [], protection: [], mask: { path: maskRel, sha256: maskSha256 } },
  ],
};

// records 页序必须严格匹配 pages
const records = [
  { pageId: page.pageId, regionId: 'r_bubble_1', message: '待てよ！', name: '主人公' },
  { pageId: page.pageId, regionId: 'r_sfx_1', message: 'ザッ' },
];

await apply(workDir, draft.revision, { pages, records, confirmed: true });
console.log(await pack(workDir, 'work/ch01.image'));
```

### 4. 导入后从工程还原并提交整包替换（`replaces`）

```js
import { writeFile, mkdir } from 'node:fs/promises';
import { restore, apply, pack } from '@lg/image';

const filePath = 'ch01.image';
const workDir = 'work/image/ch01-edit';
const draft = await restore(`sources/${filePath}`, workDir);

// 示例：调整第 1 页第 1 个区域的字号并保留原有 pageId / regionId
const pages = structuredClone(draft.book.pages);
pages[0].regions[0].style.fontSize = 22;

await apply(workDir, draft.revision, { pages, records: draft.records, confirmed: true });
const nextPkg = await pack(workDir, 'work/ch01-v2.image');

await mkdir('changes/files', { recursive: true });
await writeFile(
  ws.contract.changes.files.replaces.path,
  JSON.stringify({ file_path: filePath, source_path: nextPkg.path, inheritance_mode: 'inherit' }) + '\n',
);
// 脚本结束后调用 workspace_apply 提交 files 批次并核对 applied.files.replaced
```

### 5. 写回执行、预览审阅与正式发布

```js
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { generateFiles, getOutputPaths } from '@lg/project';
import { restore, execute, publish } from '@lg/image';

const filePath = 'ch01.image';
const workDir = 'work/image/ch01';
await restore(`sources/${filePath}`, workDir); // 与当前已入库工程快照对齐

const staged = await generateFiles([]);
if (!staged.writeback) throw new Error('Missing image writeback directory');
const run = await execute({
  workDirectory: workDir,
  writebackDirectory: path.join(staged.writeback.input_path, filePath),
  device: 'cpu',
});

for (const page of run.pages) {
  console.log(page.pageId, page.groups);
  await ws.emitImage(page.preview);
}

// 完成人工视觉与语义确认（初轮后最多两轮纠偏，仍失败则设 preserve）后发布：
const output = await getOutputPaths(); // 若 output.manual === true，先按 project-operation 用 ask_user 确认
const reviews = run.pages.flatMap((page) =>
  page.groups.map((group) => ({
    pageId: page.pageId,
    groupId: group.groupId,
    decision: group.ready ? 'accept' : 'preserve', // 实际还须已通过人工视觉与语义核对
  })),
);
const delivered = await publish({
  workDirectory: workDir,
  executionId: run.executionId,
  outputDirectory: output.translated_path,
  reviews,
});
const delivery = JSON.parse(await readFile(path.join(delivered.path, 'delivery.json'), 'utf8'));
console.log(delivered.path, delivery.status, delivery.groups);
```
