---
name: image
description: 处理漫画与图片资产：通过 shared 检测与局部放大取证确定文本区域与阅读顺序，执行掩码/背景分析与无痕消字并独立验收，生成携带干净底图的 `.image` 归档与可复用无字底图目录。
---

# 漫画图片处理（第一阶段：确认文本与干净底图）

面向需要确认原文区域、消除原图文字并沉淀可复用干净底图的图片工程与独立图片目录，交付 `.image` 归档（含 `image.json`、`items.json`、`clean.json`、`originals/`、`clean/`、`masks/`）及独立的干净底图交付目录。

## 环境准备

先通过 `@lg/npm` 与 `@lg/uv` 补齐共享工程的图片运行依赖，并按需准备图片三模型（`manga` / `det` / `inpaint`）：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
import * as image from '@lg/image';

await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
if (image.missing_models().length > 0) await image.prepare_models();
```

模型在 `prepare`（使用 `manga` 与共享 `det`）与 `erase`（仅当回退 LaMa 修复时使用 `inpaint`）按需调用宿主页独立单 Worker；`normalize`、`restore`、`pack` 与 `publish` 全程不触碰模型。

## 事务循环

```
prepare（检测取证 + 草稿建议）
  → 看 preview.png 与局部裁图 crops/ 核对文本区域与阅读顺序
  → apply（确认 regions / textAreas / kind / direction / erase / records，confirmed: true）
  → erase（整页构建掩码、自动判断平涂或 LaMa 修复，写入 runs/<runId>/）
  → review（看 mask-overlay.png 与 clean.png 逐页 accept/reject，通过才写入 reviewed/）
  → 不合格则回 apply 调 erase/textAreas 或改 preserve(repair_failed)，再重跑 erase + review
  → pack（生成 .image 归档）/ publish（导出可复用干净底图目录）
```

### 1. 检测与看图取证 (`prepare` + `read`)

- `await image.prepare({ sources, workDirectory, device })`：
  - 按原字节与 EXIF 方向保留 `originals/` 及原图身份（`pageId`、`sha256`、`width`、`height`、`orientation`），先运行无模型 `normalize` 生成方向一致的 PNG。
  - 结合 `manga` 气泡/文字分割与共享 `PP-OCR det`，对缺少文字行支撑的候选合并局部裁图后放大（长边 320，双三次插值）重检，输出 `evidence/<pageId>/preview.png` 与 `crops/<regionId>.png`。
  - `prepare` 仅提供 `candidates` 与未确认草稿（`confirmed: false`）；不得直接把检测器边界当最终定稿，更不得注入机器 OCR 译文或伪造内容。
- 用 `emitImage` 查看整页 `preview.png`，对标注为 `uncertain: true`、细小文字或嵌套气泡再看对应的 `crops/<regionId>.png` 核对：
  - `kind`: `'bubble'`（气泡内对白/独白）或 `'text'`（画面自由文字/拟声词/旁白）。
  - `textAreas`: `Quad[]`，精确包裹每条文字行，避免把气泡边线、背景网点或无关画线包进去；相邻气泡或压框情形用 `erase.exclusions` 显式扣掉保护范围。
  - `direction`: `'vertical-rl'` 或 `'horizontal-tb'`（`translate` 区域在确认时必填；`preserve` 可为 `null`）。
  - `records`: 只填人眼确认后的真实原文，按实际漫画阅读顺序（如日漫常见右上到左下分格）排列；必须覆盖全部 `translate` 区域，`preserve` 区域可保留既有 `record` 或省略；零文字封面保留空列表 `[]`。

### 2. 提交确认 (`apply`)

- 调用 `await image.apply(workDirectory, expectedRevision, { pages, records, confirmed: true })`：
  - 修改 `records` 正文、排列顺序、`direction` 或 `preserveReason`（`intentional` / `unreadable`）**不会**使已验收底图（`eraseInputDigest`）失效；
  - 修改 `textAreas`、`kind`、`disposition` 或 `erase`（`method`、`mask`、`padding`、`exclusions`）仅使受影响页面在重新 `erase` + `review` 前处于未验收状态。
- 无需或无法擦除的区域设为 `disposition: 'preserve'` 并填写 `preserveReason`（`'intentional'`、`'unreadable'` 或 `'repair_failed'`）；已确认原文的 `preserve` 区域保留其既有 `record`（新增保留区域可省略）。

### 3. 消字与独立验收 (`erase` + `review`)

- `const run = await image.erase({ workDirectory, expectedRevision, pageIds?, device })`（校验并推进 `revision`）：
  - 每个 `translate` 区域支持 `erase: { method: 'auto' | 'lama', mask: 'strokes' | 'areas', padding?, exclusions: Quad[] }`：
    - 默认 `{ method: 'auto', mask: 'strokes', exclusions: [] }`；`mask: 'strokes'` 只提取字体笔画、`mask: 'areas'` 整块涂抹。
    - `method: 'auto'` 仅在掩码周围局部多象限环带亮度一致且无渐变色偏时直填纯色，其余纹理/渐变/网点背景自动转 LaMa 修复；`method: 'lama'` 强制走 LaMa。
    - 多区域未通过 `exclusions` 声明物理重叠会报 `mask_overlap` 并拒绝生成半成品 `clean.png`。
  - 输出写入 `runs/<runId>/<pageId>/`（`clean.png`、`mask-overlay.png`、`masks/<regionId>.png` 与结构化 `gaps`），**不自动视为验收通过**；同 `eraseInputDigest` + 算法 + 模型 + 设备会复用 `cache/` 缓存。
- 用 `emitImage` 对每页实际查看 `mask-overlay.png`（确认没有漏字、误擦画线）与 `clean.png`（确认填色/修补无残影与脏块），再调用 `image.review({ workDirectory, runId, expectedRevision, pages })`（校验并推进 `revision`）：
  - 通过：`{ pageId, decision: 'accept' }`，整批校验无误后将不可变产物固化至 `reviewed/<pageId>/<artifactDigest>/` 并原子提交草稿验收引用。
  - 退回：`{ pageId, decision: 'reject', reason }`，仅撤销本次 `runId` 关联的验收引用（保留其它 `runId` 的已验收成果），回到 `apply` 修正 `textAreas` / `erase` 或降级为 `preserve` (`'repair_failed'`)，重新 `erase` + `review`。

### 4. 打包、恢复与交付 (`pack` / `restore` / `publish`)

- `pack(workDirectory, outputImagePath)`：要求整书 `confirmed: true` 且全部页面通过 `review`；生成 `.image` 归档（含 `image.json`、`items.json`、`clean.json`、`originals/`、`clean/`、`masks/`），逐页校验 SHA-256 与掩码外像素一致性。`clean.json.status` 在不存在 `'unreadable'` / `'repair_failed'` 保留区域（即仅含成功消字的 `translate` 与 `'intentional'` 保留）时为 `'complete'`，存在任意 `'unreadable'` 或 `'repair_failed'` 时为 `'partial'`。
- 导入/更新工程条目走 `project-operation`；译文确定后工程导出通过通用 `items.json` 写回，不依赖二次图片排版宿主。
- `restore(sourceDirectory, workDirectory)`：从工程 `sources/<asset>/` 离线恢复工作区及已验收 `reviewed/` 状态（同时失效过期 `normalized/` 缓存），若仅增删译文、重排 `records` 或调整 `direction`，全程无需模型即可再次 `pack` 或 `publish`。
- `publish({ workDirectory, outputDirectory, expectedRevision? })`：幂等原子导出独立可复用干净底图目录（按自然页序命名的 `0001-<pageId>.png` 与 `delivery.json`），并在重复交付时校验已落盘底图完整性。
