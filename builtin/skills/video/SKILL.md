---
name: video
description: 导入、识别、翻译、审校视频或音频，或生成视频字幕前必须加载。
---

本技能提供视频与音频的本地识别、画面文字查看、核对和字幕渲染方法。导入、更新与交付按 `project-operation` 执行，翻译、术语与审校按 `translation` 执行。

目标是得到忠实于实际声音和画面的原文条目：台词不漏、不臆造，时间贴合说话，观众需要读懂的画面文字单独保留。对白来自本地 ASR，画面文字由本地检测定位、你看图识别，最终条目由你结合 ASR、硬字幕和画面文字判断产出。下文的步骤是建议，按素材实际情况取舍。

# 包与材料

`.video` 是 ZIP 包。后端只按 `items.json` 的 `message` 和可选的 `name` 建立条目，其余成员和字段由本技能解释。时间均为整片秒数，零点与音频一致。

|成员|内容|
|---|---|
|`video.json`|识别证据与原文件身份，见下表|
|`items.json`|字幕原文记录，数组下标就是条目的 `row_number`|
|`render.mjs`|可选，用户要求固定的定制渲染|

`video.json`：

|字段|内容|
|---|---|
|`source`|原文件身份：`path`、`size`、`mtime_ns`、`track`、`language`。复核时据此找回原文件|
|`duration`|时长|
|`video`|原画面尺寸 `{ width, height }`，纯音频为 `null`|
|`speech`|人声区间 `[[start, end]]`|
|`asr`|本地识别的句子 `{ start, end, text, tokens }`。`tokens` 是文字 token 的 `[原文, 起点]`，不含标点|
|`text`|画面文字区间 `{ id, start, end, at, box }`，纯音频为 `null`|

- 无音轨时 `speech` 与 `asr` 为 `null`。
- `text` 来自 1 fps 检测，`start` 是首次检测到的秒数，`end` 是最后一次检测到的秒数加 1，起止各有约 1 秒误差。`at` 是文字框最大的一帧，`box` 是区间内文字框的并集，归一化为 `[x0, y0, x1, y1]`。

`items.json` 的每行：

|字段|要求|
|---|---|
|`start`、`end`|`0 ≤ start < end ≤ duration`|
|`kind`|`dialogue`（说出的话）或 `screen`（画面文字）|
|`message`|非空原文|
|`name`|可选，说话人|
|`box`|可选，只用于 `screen`，格式同 `text[].box`。生成字幕时译文贴着它摆放|

每个资产使用独立的工作目录 `work/video/<资产名>/`。目录中除包成员外还有 `text/<id>.jpg`（区间代表帧的裁图）、`sheets/`（图集）和 `recognition/`（视频模型补查材料），这些不打包。

## 脚本

|脚本|入口|用途|
|---|---|---|
|`media.mjs`|`missing`、`setup`|检查、安装依赖与模型|
||`inspect`、`ffmpeg`|读取媒体信息，截帧、提取字幕等 ffmpeg 操作|
||`prepare`|本地识别对白、检测画面文字，生成初始 `items.json`|
||`scan`|重新检测画面文字，生成裁图|
||`sheets`|把裁图拼成图集|
||`refine`|校准 `screen` 行的起止时间|
||`locate`、`relink`|找回原文件，或改用新路径|
||`pack`|校验记录并打包|
|`recognize.mjs`|`check`|记录与本地证据的对照|
||`request`、`read`、`apply`|视频模型补查，仅用户要求时使用|
|`render.mjs`|`render`|默认 ASS 渲染|

脚本从本技能 `read_skill` 返回的 `base_url` 导入：

```js
const media = await import(new URL('scripts/media.mjs', base_url).href);
const recognize = await import(new URL('scripts/recognize.mjs', base_url).href);
```

# 环境准备

开始操作前调用 `media.missing()`，它返回缺失的 npm 包、Python 包与模型。有缺失时：

1. 告诉用户首次使用需要下载功能组件，大约 450 MB，请保持网络畅通。
2. 调用 `media.setup()` 安装依赖，并通过预置的 `aria2c` 下载、校验模型。下载失败或中断后重新调用，沿用保留的临时文件及 `.aria2` 文件续传。

# 准备

- 有文本字幕流时，先用 `ask_user` 询问是否改为提取字幕。提取比识别准确，用 `media.ffmpeg(args)` 导出后按 `project-operation` 导入。
- 有多条音轨时请用户选择。`track` 是 `media.inspect(来源)` 返回的 `audio` 中从零开始的位置。
- 有音轨时支持中、英、日、韩原文，以及 `ALL` 自动识别。其他语言会使 `prepare` 报错，告诉用户本功能不支持该语言的对白。

调用 `media.prepare(来源, 工作目录, { track, language })`，`language` 取 `project_meta.json` 的 `source_language`。它同时运行本地 ASR 和画面检测，不请求付费模型。一小时素材需要几分钟到十几分钟，4K 素材更久，开始前告诉用户。中断后用相同参数续跑，已完成的部分不再重复。

`prepare` 在缺少 `items.json` 时，把每条 `asr` 转为 `dialogue` 记录。已有 `items.json` 原样保留，包括空数组。`asr` 为 `[]` 表示执行了识别但没有产出文字。

# 建议步骤

1. 通读 `asr`，了解内容、人物和术语，留意近音误字、写成片假名的专名和断成两半的句子。
2. 用 `media.sheets(工作目录)` 生成图集，它返回 `[{ file, ids }]`。按返回的 `file` 分批用 `ws.emitImage` 查看，每次 `workspace_run` 最多 10 张。逐个区间判断：
   - 画面文字（标题、字幕卡、招牌、名片、文稿、新闻横幅）：写成 `screen`，`box` 取自区间，时间先用区间的起止。
   - 对白硬字幕：作为对白的第二份证据，对照 ASR 修正 `dialogue` 的文字。断行可以按硬字幕调整，时间仍以 ASR 为准。
   - 台标、水印、无意义的背景字、看不清的文字和误检：忽略。
3. 修正对白。拆句、合句时按 `asr[].tokens` 取切点，起止尽量贴合人声区间。专名和误字逐行结合上下文改，不对全部对白做正则替换：替换会叠加或误伤包含同一串字的其他词。
4. `screen` 行写好后，用 `media.refine(工作目录, 行号数组)` 校准起止时间。它直接写回 `items.json`。`unresolved` 列出未能校准的行，这些行保留原时间。边界超出原时间前后 1 秒，或条目中点未检测到文字时，校准会失败。
5. 调用 `recognize.check(工作目录)` 查看线索。线索都有解释，或没有新证据可用时结束。

`check` 返回：

|字段|含义|
|---|---|
|`invalid_rows`|结构或时间不合法的行号，打包前必须修正|
|`uncovered`|被 `dialogue` 覆盖不到一半的 ASR 句子，附识别文字|
|`unsupported`|时间范围内没有任何人声的 `dialogue` 行号|

`uncovered` 可能来自漏句、时间偏移或无需翻译的声音。`unsupported` 可能来自臆造、时间错位或人声检测漏掉的短句。没有告警不能证明字幕正确。

# 避坑

- ASR 可能出现近音误字，也可能把专名、术语写成片假名或近音词。数字可能按读音规范化。多人嘈杂时可能整句丢失。人声检测漏掉的对白没有文字。5.1、7.1 素材只听中置声道。ASR 没有区分说话人。
- 硬字幕不一定是逐字转写。日本综艺的テロップ常是强调或概括，按 `screen` 判断是否保留，不要替换对白。官方硬字幕也可能是精简版。
- 译文语言的硬字幕（例如日片配中文字幕）不是原文，不能写进 `message`。生成字幕时仍会避开它。
- 检测只给位置。一个区间可能混进不同的文字。同一句硬字幕也可能因漏检拆成两个区间。以图像为准合并或拆分。人脸、衣服、动画人物可能被误检，确认没有字即可跳过。
- 区间起止有约 1 秒误差，不能直接作为对白时间。只在硬字幕里出现的对白，先用区间时间，再对齐到最近的人声区间边界。
- 只在 ASR、硬字幕和画面中已有的读法里选择，或纠正明显的同音误字。看不清的文字直接放弃，不要拼凑。
- 文稿、名片等高的区域在图集里会缩得很小。单独 `emitImage` 对应的 `text/<id>.jpg`，仍不够时用 `media.ffmpeg()` 从 `media.locate(工作目录)` 返回的原文件按 `at` 截帧。
- 你不能看图时停止看图，告诉用户画面文字没有识别。对白与避让不受影响。
- 不要为了消除 `check` 的告警把字幕拉长，这会掩盖真正漏掉的句子。多人同时说话时字幕可以重叠。
- `items.json` 的下标是 `row_number`，重新打包时改变顺序会影响译文继承。只调整时间或样式时保持原文与顺序。

# 导入与更新

`media.pack(工作目录, 'work/video/<原视频主名>.video')` 校验 `items.json` 并打包，保留数组顺序。首次导入按 `project-operation` 新增，重新处理已导入的资产时按「更新文件」提交并继承译文。核对打包记录数和回执条目数。

# 翻译

只在用户要求时按 `translation` 翻译。用户只要求导入或识别时，停在导入完成。

# 复核与重新处理

已导入的资产从 `sources/<file_path>/` 复制到新的工作目录。工作目录没有裁图，先调用 `media.scan(工作目录)` 重新生成。

`scan`、`refine` 和视频模型补查都按 `video.json` 的 `source` 找回原文件。`media.locate(工作目录)` 在原文件不存在或大小、修改时间变化时报错。此时用 `ask_user` 请用户提供新路径，再调用 `media.relink(工作目录, 新路径)`。它核对时长、画面尺寸和所选音轨后更新 `source`。资产已导入时，重新打包并按「更新文件」提交，新路径才保存进工程。

# 视频模型补查

只在用户明确要求时使用，例如某段音乐或嘈杂场景 ASR 完全失效，用户要求改用视频模型识别。它会花费额度，次数由用户决定。

1. `recognize.request(工作目录, { prompt, ranges })` 从原文件裁出 `ranges`（`[{ start, end }]` 整片时间，每段不超过 210 秒）并写出请求清单，返回 `request_file`。
2. 调用 `batch_llm_request({ model_usage: "agent_media", request_file })`。
3. `recognize.read(工作目录, result_file)` 把响应换算为整片时间写入候选文件 `candidate`，返回各区间的行数、`incomplete`（输出没有正常结束）、无法解析或不符合契约的行数，以及失败的区间。
4. 审阅候选后，`recognize.apply(工作目录, candidate, ranges)` 用完整且非空的候选替换区间内的 `dialogue`。区间内的 `screen` 保持不变。

基线提示词如下。输出格式是 `read` 的解析契约。语言名称取自 `project_meta.json`，模型看到的时间从区间起点算起。需要区分说话人时可以要求输出字符串字段 `name`。

```text
转写这段视频中实际说出的对白。语言：{原文语言}。
每行输出一个 JSON 对象，不输出代码块或说明：
{"start":秒,"end":秒,"kind":"dialogue","message":"原文"}
- start、end 为相对本段开头的秒数，保留两位小数，按 start 排序。
- 每句一行，尽量不超过 7 秒和 30 字，长句按自然停顿拆开。
- 忠实转写，不总结、不润色、不补写。听不清的部分写 [?]。否定、数字、人名按原样转写。
- 没有人声时不输出任何内容。
```

空输出和截断很常见，不能覆盖已有原文。请求载荷可达数十 MB，批量结束后可以删除请求目录中的 `.request.json`。

# 生成与交付

`generateFiles(bilingual_files)` 之后，用 `render({ source, input, translated, bilingual })` 写出与原视频同主名的 ASS：

- `source` 是 `sources/` 中的包目录。
- `input` 是 `<writeback.input_path>/<file_path>/items.json`。
- `translated` 与 `bilingual` 是译文与双语输出路径。

包内有 `render.mjs` 时，读取并检查后改用它。交付时告诉用户：字幕与原视频同名并放在同一目录，播放器即可自动加载。

默认渲染中，对白在底部居中。与同一时间检测到的文字区域重叠时，该条改用半透明底框。带 `box` 的 `screen` 译文优先放在原文框下方，并避开同时出现的其他文字。下方放不下时改放上方。两侧都没有空位时优先保证译文可见。没有 `box` 的 `screen` 在顶部居中。字号随画面高度缩放。

用户要求其他样式时，把 `render.mjs` 复制到 `work/` 修改，保持导出签名不变。用户要求固定该样式时，把包目录复制到工作目录，放入 `render.mjs` 后重新打包。再按「更新文件」提交。

# 覆盖缺口

交付时按下表检查，只向用户说明本资产满足条件的项：

|条件|向用户说明|
|---|---|
|对白来自本地 ASR|没有区分说话人|
|有放弃或存疑的画面文字|位置和原因|
|没能看图|画面文字没有识别|
|有未决项|位置、两种读法或缺失的内容|

交付时说明实际采用的识别来源和已执行的核对范围。建议用户播放抽查，并用时间点反馈问题。
