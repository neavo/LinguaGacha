---
name: image
description: 调查、翻译、审校或交付漫画与独立图片，或制作、更新、写回 `.image` 资产时使用。
---

本技能处理漫画与独立图片。

- 应用 SDK 完成文字识别、分区和消字。
- 本技能脚本构造、校验并封装当前 `.image`。
- Agent 负责材料归属、旧包语义、原文修正、工程条目取舍和结果说明。

脚本从本技能 `read_skill` 返回的 `base_url` 导入：

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
```

# 来源调查

- 游戏目录中的图片先由对应引擎技能判断归属。只有需要作为独立图片资产处理时，才交给本技能。
- 按自然阅读顺序组成同一话或同一连续阅读单元。无关图片分开封装。
- 核对页数、方向、分辨率、重复页与原始相对路径。顺序不明确时先解决。
- 只查看或分析时直接读取原图。需要进入工程或交付译图时制作 `.image`。

# 导入准备

图片脚本只声明依赖，不自动安装。

只在需要制作或重做 `.image` 时准备环境。

先在独立调用中检查模型缺口：

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
console.log(JSON.stringify({ missing: image.missing_models() }));
```

本次任务首次发现缺口时，先告诉用户一次「首次使用需要下载约 300 MB 的依赖与模型，后续重复使用」，再在新的调用中准备依赖与模型：

```js
import { npm } from '@lg/npm';
import { uv } from '@lg/uv';
const image = await import(new URL('scripts/image.mjs', base_url).href);
await npm.run(['install', '--save-exact', ...image.IMAGE_DEPENDENCIES.npm]);
await uv.run(['add', ...image.IMAGE_DEPENDENCIES.python]);
await image.prepare_models();
console.log(JSON.stringify({ missing: image.missing_models() }));
```

准备失败时重新读取缺口，报告实际剩余资源。不要伪造模型结果继续封包。

新图片整册只调用一次 `prepare`。

它默认使用 GPU。

准备完成后再封包：

```js
const image = await import(new URL('scripts/image.mjs', base_url).href);
const prepared = await image.prepare(
  sources.map((source) => ({
    path: source.path,
    relativePath: source.relativePath,
  })),
  'work/image/ch01',
);
const packed = await image.pack('work/image/ch01', 'work/image/ch01.image');
```

`relativePath` 相对本批图片共同来源根目录，使用 `/`，保持原目录与文件名。不同页面不能使用大小写不敏感的同一路径。

- `prepared.pages` 提供整页诊断预览、OCR 区域数量和消字失败清单。
- 消字失败可以随资产导入，输出时恢复原图区域。
- 准备抛错时停止并报告。
- GPU 准备首次抛出 `image.DeviceFailure` 时，告诉用户「GPU 加速不可用，本次任务已切换至 CPU 模式，处理速度会比较慢」。
- 用相同来源和工作目录在新调用中传入 `{ device: 'cpu' }` 完整重跑。
- 本次任务的后续图片都使用 CPU，不重复提醒。
- 模型、输入、环境或资源关闭错误按原错误处理，不靠切换设备重试。CPU 失败后不再切回 GPU。
- 把 `.image` 交给 `project-operation` 识别和提交。更新已导入资产时使用「更新文件」，继承可复用译文。

已有 `.image` 需要归一化或修正原文时：

1. 调用 `image.unpack(来源, 新工作目录)`，只做安全解包。
2. 调用 `image.describe_package()` 获取当前三个 JSON 的机器声明。
3. 结合旧包实际内容理解页面、区域和原文语义。
4. 在工作目录的 `package/` 中构造当前材料。
5. 只修正原文时编辑 `items.json[].message`。
6. 调用 `image.read()` 检查当前 JSON，再调用 `image.pack()` 检查成员和像素并封包。

不能可靠映射页面、区域或像素成员时，重新准备原图或保留未决。

不要猜测标识、路径和掩码，也不要修改原始包。

# 原稿与条目

条目按页面与阅读顺序排列。`tag` 表示区域来源：

- `bubble`：气泡文字，默认进入翻译。
- `unframed`：无框文字，在「可见文本补漏」中判断是否需要翻译。

所有 OCR 有效区域都进入工程。OCR 空结果不产生条目。图片输出按工程条目状态解释：

|状态|输出|报告|
|---|---|---|
|`PROCESSED`|译文|成功、警告或失败后回退原图|
|`EXCLUDED`|原图区域|成功|
|其他未完成状态|原图区域|失败：翻译未完成|

改为 `EXCLUDED` 不会清空已有 `dst`，以后恢复 `PROCESSED` 时可以继续使用已有译文。

# 可见文本补漏

只在 `translation` 的全文补漏条件满足时执行。一次读取目标图片资产的全部 `unframed` 条目：

- 明确旁白、正文、标题：保持 `PROCESSED`。
- 明确拟声词、装饰文字、画面标签：改为 `EXCLUDED`。
- 仅凭文本无法决定：保持 `PROCESSED`，加入整页视觉待决清单。

`bubble` 默认保持 `PROCESSED`。不要逐条打开原图确认。本节只决定图片是否输出译文，不评价翻译质量。

# 翻译后检查

相关译文写入后生成一次整页 QA 图片：

```js
import { generateQA } from '@lg/image';
const qa = await generateQA();
```

按 `qa.output_path` 逐页查看完整图片：

- 绿色：输出译文。
- 灰色：输出原图。
- 黄色：翻译未完成或仍需判断。
- 红色：消字或排版失败。

结合「可见文本补漏」的待决清单处理：

- 一眼确认应翻译：保持 `PROCESSED`。
- 一眼确认不应翻译：改为 `EXCLUDED`。
- 看不清的非气泡文字：改为 `EXCLUDED`。
- 红色区域记录失败，不裁图、放大、改译文长度或反复重试。

提交状态调整后结束本阶段，不调用普通 `generateFiles`。正式成果由 `project-operation` 的「导出与交付」生成。

# 写回与验证

`project-operation` 调用 `generateFiles` 时，文件生成服务直接完成图片排版、原图回退和写出。图片不会进入 `writeback.files`，Agent 不修改排版输入。

对照返回的 `image_report` 和其 `path` 指向的 `.lg-export-report.json` 核对：

- 工程中的每个图片页面都有对应输出。
- `summary` 中成功、警告、失败、原图输出和译文输出数量与详细条目一致。
- 详细条目的 `path`、`region_id`、`status`、`output` 和 `reasons` 能说明实际结果，不根据目录或颜色推断状态。

# 交付说明

交付时说明 `.image`、成品目录、页面总数，以及成功、警告、失败、原图输出和译文输出数量。

按页面与区域列出消字失败、翻译未完成、无法排版、越界、小字号、边距偏小和中心偏移。没有对应情况时不逐项罗列。
