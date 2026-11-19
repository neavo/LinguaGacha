---
name: media
description: 翻译、审校、分析、修改音视频文件（含 .media 文件）前必须加载。
---

# 音视频处理能力

本技能提供音视频的本地识别、画面文字识别、对白核对、字幕渲染与纯音频双语成片方法。目标是产出忠实于声音与画面的原文条目，并按「识别时翻译」形成译文：

1. 台词不漏、不臆造，时间贴合说话。
2. 对白来自本地 ASR，ASR 解决不了的区间经用户确认后交给视频模型补查。
3. 观众需要读懂的画面文字单独保留，由本地检测定位、再由你看图识别。

按 `media.inspect(来源)` 返回的 `video` 区分素材分支，不按扩展名判断（含封面图片的音频仍属纯音频）：

|分支|判断条件|识别范围|交付成果|
|---|---|---|---|
|视频|`video !== null`|对白与画面文字|译文 ASS、双语 ASS|
|纯音频|`video === null`|仅对白，跳过所有画面步骤|译文 ASS、双语 ASS、烧录双语字幕的 MP4|

阶段导航：

|阶段入口|章节|
|---|---|
|来源调查|「来源调查」|
|导入准备|「环境与设备」「本地识别」「对白核对」「画面文字识别」「视频模型补查」「识别时翻译」「封包、导入与更新」|
|原稿与条目|「资产包与工作目录」「脚本与分发边界」「复核与维护」|
|写回与验证|「字幕渲染」「音频双语成片」「产物验证」|
|交付说明|「交付说明」|

阶段例外：已进入对话上下文的条目在导入准备中一并翻译，见「识别时翻译」，工程外原文件按「复核与维护」找回。

# 执行铁律

放大不会恢复缺失细节，反而丢失画面构图与语境，严禁自行二次切片或放大，图集看不清时直接查看现成的 `text/<id>.jpg` 或按 `at` 截完整视频帧，仍看不清即放弃。

# 开场声明

加载技能后提醒用户「无需音视频模型也可以工作，但在子模型中设置支持音视频输入的模型比如 Gemini 可获得更好的效果」

# 来源调查

准备依赖后，先用 `media.inspect(来源)` 确定分支，再按流信息处理：

- **文本字幕流**：存在时先用 `ask_user` 询问是否改为直接提取字幕；确认后用 `media.ffmpeg(args)` 导出并按 `project-operation` 导入。
- **多条音轨**：存在时请用户选择目标音轨，`track` 为 `inspect` 返回 `audio` 中从 `0` 开始的索引。
- **原文语言**：有音轨时仅支持中、英、日、韩原文及 `ALL` 自动识别；其他语言会使 `prepare` 报错，告知用户不支持该语言的对白。

# 导入准备

## 环境与设备

识别、检测与音频成片统一使用 `scripts/media.mjs` 的固定版本清单：

```js
await npm.run(['install', '--save-exact', ...media.NPM_DEPENDENCIES]);
await uv.run(['add', ...media.PIP_DEPENDENCIES]);
```

- 忽略 npm 拦截 `onnxruntime-node` 安装脚本的警告，不要批准。
- 识别模型用 `media.missing_models()` 检查、`media.prepare_models()` 下载校验并续传；纯音频成片不需要识别模型。

执行顺序：

1. 在独立调用中按清单检查依赖（版本不符也算缺口）；需要识别或检测时同时检查模型。
2. 用独立调用补齐缺口；首次准备识别模型前，先告知用户下载量约 550 MB，后续可复用。
3. 用 `media.inspect(来源)` 确定分支，按「来源调查」处理字幕流与音轨。

### 设备降级与重跑

任务开始时令 `device = 'gpu'`。`prepare`、`scan`、`refine` 必须显式传入 `device`，SDK 不自行换设备：

- **GPU 降级**：首次捕获 `media.DeviceFailure` 时，告知用户「GPU 加速不可用，本次任务已切换至 CPU 模式，处理速度会比较慢」，改为 `device = 'cpu'` 用相同工作目录和参数重跑失败步骤（`prepare` 已完成的一支自动复用），本次任务后续统一使用 CPU 且不再提醒。
- **并行双败**：`prepare` 两支同时失败抛出 `AggregateError`，仅当 `errors` 全为 `DeviceFailure` 时降级重跑。
- **其他错误**：模型、输入、环境和资源关闭错误按原错误处理；CPU 失败时报告原因，不切回 GPU。

|重跑场景|调用方式|说明|
|---|---|---|
|重跑对白 / 画面|`prepare(来源, 工作目录, { track, language, device, rerun: ['speech'] \| ['text'] })`|省略 `rerun` 复用已有结果；保留已有 `items.json`|
|重建画面检测|`scan(工作目录, { device })`|仅视频，重建裁图与 `text`，新区间编号可能变化|
|重算画面时间|`refine(工作目录, 行号数组, { device })`|仅视频，校准指定 `screen` 行|

## 本地识别

调用 `media.prepare(来源, 工作目录, { track, language, device })`，`language` 取 `project_meta.json` 的 `source_language`。

- 本地 ASR 与画面检测并行执行，不请求付费模型；耗时数分钟（4K 或 CPU 模式显著更久），开始前告知用户。
- 中断后用相同参数续跑，已完成分支自动复用。
- 缺少 `items.json` 时自动将 `asr` 转为 `dialogue`；已有 `items.json` 原样保留（含空数组）。`asr` 为 `[]` 时如实告知用户，不编造条目。

## 对白核对

视频与纯音频共用：

1. 通读 `asr`，留意近音误字、片假名专名与断句。
2. 修正对白：拆合句按 `asr[].tokens` 取切点并贴合人声区间；逐行结合上下文修改，不做全量正则替换；视频结合硬字幕作为第二份证据。
3. 调用 `recognize.check(工作目录)` 查看线索，直到线索均有解释或无新证据可用。
4. 汇总 ASR 解决不了的区间，打包前按「视频模型补查」提议：
   - `asr` 为空且上下文与画面无法排除是对白的 `uncovered` 区间。
   - 识别文字文意不通、凭现有证据无法修正的片段。

|`recognize.check()` 字段|含义与排查重点|
|---|---|
|`invalid_rows`|结构或时间不合法的行号，打包前必须修正|
|`uncovered`|人声区间中至少 1 秒未被 `dialogue` 覆盖的 `{ start, end, asr }`；`asr` 非空多为漏句或偏移，为空可能是歌唱、喊叫、嘈杂重叠对白或非对白声音|
|`unsupported`|时间范围内无人声的 `dialogue` 行号，可能来自臆造、时间错位或 VAD 漏检短句|

核对约束：

- 优先依据 `speech`、`asr` 和 `recognize.check()`；静音或音量检测仅作辅助定位，能量高低不能证明是否存在对白或排除待补查区间。
- 留意本地 ASR 局限：近音误字、片假名专名、数字按读音规范化、多人嘈杂漏句、VAD 漏短句、5.1/7.1 只听中置声道、不区分说话人。
- 只在 ASR、硬字幕和画面已有读法中选择或纠正明显同音误字；不为消告警拉长字幕（多人同时说话允许重叠）。
- `items.json` 下标即 `row_number`，只调时间或样式时保持原文与顺序，避免破坏译文继承。
- 修正对白时，已进入对话上下文的对白条目按「识别时翻译」形成译文并暂存。

## 画面文字识别

仅视频执行，纯音频跳过。

1. 调用 `media.sheets(工作目录)` 生成图集，返回 `[{ file, ids }]`；按 `file` 分批用 `ws.emitImage` 查看（每次 `workspace_run` 最多 10 张），逐区间判断并按「识别时翻译」形成译文。
2. 写好 `screen` 后，调用 `media.refine(工作目录, 行号数组, { device })` 校准起止时间（窗口为原边界前后各 1 秒，明显偏离先改时间再校准），结果写回 `items.json`；`unresolved` 保留原时间，需结合原视频核对。

判断范围涵盖标题、字幕卡、招牌、名片、文稿、新闻横幅，以及动态漫画的气泡、旁白、内心独白、拟声词和拟态词；竖排、倾斜、装饰字体与高瘦文字框同样判断。

|观察到的内容|处理方式|
|---|---|
|可辨认且承载信息的画面文字|写成 `screen`，`box` 取自区间，时间先用区间起止|
|对白硬字幕，或与同段实际对白完全对应的气泡|作对白第二证据修正 `dialogue`，不另写 `screen`；断行可参考它，时间以 ASR 为准|
|气泡含未说出部分，或属独立叙述|保留独立 `screen`，附近有声音不是去掉的理由|
|画面与配音表达不完全一致|按实际信息分别判断，不只凭相似词或时间重叠去重|
|拟声词、拟态词|画面即证据，无声音也写 `screen`；有声音无字时不臆造|
|台标、水印、无意义背景字、纯装饰图形、无字动作线、误检|忽略|

看图与截帧要点：

- 按语言、气泡和版面确定阅读顺序，检测编号只用于定位；OCR 只用于区间划分，原文以裁图为准，误检直接跳过。
- 结合前后帧核对换字与跨区间合并；相同文字的不同出现（如同一帧两处「ドン」）不只凭字符串去重。
- 按「执行铁律」处理模糊画面：截完整帧时用 `media.ffmpeg()` 从 `media.locate(工作目录)` 返回的原文件取帧，放弃时记录位置和原因，不拼凑。
- 1 fps 检测可能漏掉短于 1 秒的文字，出现快闪、转场或叙事缺线索时局部截帧补查，不逐帧遍历全片。
- 无法看图时停止看图并告知用户画面文字未识别；对白与避让不受影响。
- 日本综艺テロップ常为强调或概括，按 `screen` 判断而不替换对白；官方硬字幕也可能是精简版。
- 译文语言的硬字幕（如日片中文字幕）不写入 `message`，渲染时仍会自动避开。
- 区间起止约有 1 秒误差；仅出现在硬字幕中的对白先用区间时间，再对齐到最近人声区间边界。

## 视频模型补查

音视频子模型用于重识 ASR 解决不了的区间（纯音频自动补黑画面以视频形式发送）。**此步骤会产生模型费用，必须先经用户确认。**

- 用一次 `ask_user` 提议：逐段列出时间与原因、说明请求次数，请用户选择补查范围；拒绝的区间作为未决项交付。
- 区间外延到句子边界，相近区间合并为一段。

1. `recognize.request(工作目录, { prompt, ranges })`：裁出 `ranges`（`[{ start, end }]` 整片时间，每段 ≤ 210 秒）并写出请求清单，返回 `request_file`。
2. `batch_llm_request({ model_usage: "media", request_file })`：提交批量识别。
3. `recognize.read(工作目录, result_file)`：换算为整片时间并写入 `candidate`，返回各区间行数、异常行数及失败区间。
4. 审阅候选后，调用 `recognize.apply(工作目录, candidate, ranges)` 替换区间内 `dialogue`（`screen` 不变）；采纳的对白按「识别时翻译」暂存译文。

基线提示词（输出格式为 `read` 解析契约；语言取自 `project_meta.json`，时间为区间相对秒数；需区分说话人时可要求输出字符串字段 `name`）：

```text
转写这段视频中实际说出的对白。语言：{原文语言}。
每行输出一个 JSON 对象，不输出代码块或说明：
{"start":秒,"end":秒,"kind":"dialogue","message":"原文"}
- start、end 为相对本段开头的秒数，保留两位小数，按 start 排序。
- 每句一行，尽量不超过 7 秒和 30 字，长句按自然停顿拆开。
- 忠实转写，不总结、不润色、不补写。听不清的部分写 [?]。否定、数字、人名按原样转写。
- 没有人声时不输出任何内容。
```

- `succeeded` 只表示调用完成；空输出或截断区间不传 `apply`，付费重试前先问用户。
- 纯音频黑帧视频可能带出超出音轨的尾段，时长异常时检查生成文件。
- 审阅完成后按对应尝试目录清理诊断材料，保留其他批次证据。

## 识别时翻译

已进入对话上下文的条目（画面文字、通读修正的对白、补查采纳的对白）直接形成译文。用户只要求导入或识别时也一并翻译，明确要求不翻译或只留原文时除外；无需另问，也不触发 `translation` 的翻译或审校询问。

- 形成译文前加载 `writing-guide`，按 `translation` 的「术语表」读取适用术语，目标语言取 `project_meta.json` 的 `target_language`。
- 译文须覆盖该行完整原文；修正到 `dialogue` 的气泡或硬字幕，仅当译文覆盖整句对白时才写入。
- 拟声词、拟态词按语境翻译，仅需稳定复用的特定表达按 `glossary` 入术语表。

## 封包、导入与更新

调用 `media.pack(工作目录, 'work/media/<原文件主名>.media')` 校验并打包（保留数组顺序）。首次导入按 `project-operation` 新增，重新处理按「更新文件」提交并继承译文，核对打包记录数与回执条目数。

有识别时译文时，待原文定稿后按最终行号写入 `translations.json`（每项 `{ row, message, dst }`），导入后写入工程：

1. 按回执实际 `file_path` 和 `row_number` 从最新快照找条目，核对 `src === message`。
2. 用当前 `item_id` 和 `fp`，按 `<workspace_contract>` 向 `ws.contract.changes.items.updates.path` 提交 `dst`（原译相同照常提交）。
3. 核对回执与最新快照，确认已识别、已写入、未决和失败条数；原文与译文均入库后才确认双语导入。
4. 需继续翻译时，将本资产最新快照中 `NONE` 的剩余条目作为限定目标交由 `translation`。

恢复与继承：

- 回执 `parse_failed` 时资产已在工程中，按 `project-operation` 处理，不重复新增。
- 译文提交失败或 `fp` 失效时保留资产与 `translations.json`，重读快照续做未写入行；原文已变的行重新判断对应关系，不按旧行号覆盖。
- `translations.json` 丢失时从原稿和原文件重建证据，不覆盖已有译文；「更新文件」继承及用户修订的译文不批量覆盖，仅补齐缺失条目。

# 原稿与条目

## 资产包与工作目录

`.media` 为 ZIP 容器，保存识别证据与字幕原文，不含原文件；时间均为整片秒数（零点与音频一致）。生成字幕只需包，生成成片还需原文件。

|包成员|说明|
|---|---|
|`media.json`|原文件身份 `source`、对白证据 `speech`/`asr`、视频 1 fps 画面文字区间 `text`；`pack` 只接受全部分支已结算的正式清单|
|`items.json`|`dialogue` 或 `screen` 记录（数组下标即 `row_number`），正文非空且时间在时长内；`screen` 仅视频可用，可带归一化 `box`|
|`render.mjs`|可选，用户要求固定的定制渲染脚本|

工作目录 `work/media/<资产名>/` 内不打包的临时材料：`translations.json`、`text/<id>.jpg`、`sheets/`、`recognition/`。

## 脚本与分发边界

|脚本|入口|用途|
|---|---|---|
|`media.mjs`|`NPM_DEPENDENCIES`、`PIP_DEPENDENCIES`|固定版本依赖清单|
||`missing_models`、`prepare_models`|检查与准备识别模型|
||`describe_package`、`unpack`|获取当前字段声明，安全展开旧包|
||`inspect`、`ffmpeg`|读取媒体信息，执行截帧、提取字幕等 FFmpeg 操作|
||`prepare`|本地识别对白（视频同时检测画面文字），生成初始 `items.json`|
||`scan`、`sheets`、`refine`|仅视频：重建画面文字检测与裁图、拼图集、校准 `screen` 起止时间|
||`locate`、`relink`|找回原文件，或重连新路径|
||`pack`|校验正式清单与记录并打包|
|`recognize.mjs`|`check`、`request`、`read`、`apply`|对白核对与视频模型补查|
|`render.mjs`|`render`|默认 ASS 渲染|
|`visualize.mjs`|`visualize`|仅纯音频：用双语 ASS 生成可视化 MP4|

媒体技能入口使用同包的 Python 脚本（`helper.py`、`fsmn_vad.py`、`visualize.py`）。`@lg/media` 负责模型、FFmpeg、推理 Worker 和成片发布，`media.mjs` 负责工作目录、来源身份与打包。从 `read_skill` 返回的 `base_url` 导入入口：

```js
const media = await import(new URL('scripts/media.mjs', base_url).href);
const recognize = await import(new URL('scripts/recognize.mjs', base_url).href);
```

- **自定义技能与 SDK 约定**：覆盖 `media` 技能时，将 JS 入口与三个 `.py` 脚本一同放入该技能 `scripts/`；直接调用 `@lg/media` 时，用 `create_media_pipeline(script)` 绑定 `helper.py`、用 `visualize(script, source, options)` 指定成片脚本（均为技能包内文件 URL）；成片分辨率由背景图、字幕与该包 `visualize.py` 共同约定。
- **FFmpeg 兜底**：优先用业务入口；否则调用 `media.ffmpeg(args)`（SDK 自动加 `-hide_banner` 和 `-nostdin`）。诊断输出先筛选再控长，大输出使用滤镜文件输出：

```js
const diagnostic = await media.ffmpeg(args);
console.log(diagnostic.split(/\r?\n/u).filter((line) => line.includes('silence_')).join('\n'));
```

## 复核与维护

- **复核已导入资产**：从 `sources/<file_path>/` 复制到新工作目录；视频不含裁图，沿用 `device` 调用 `media.scan(工作目录, { device })` 重建（新区间编号和框仅在本次有效）。
- **重连原文件**：`media.locate(工作目录)` 报错时，用 `ask_user` 请用户提供新路径（不自行搜同名文件），调用 `media.relink(工作目录, 新路径)` 核对时长、画面尺寸与音轨并更新 `source`；已导入资产需重新打包并按「更新文件」提交。
- **旧包归一化**：`media.unpack(来源, 新工作目录)` 后用 `media.describe_package()` 对照字段重建 `media.json` 与 `items.json` 再 `media.pack()`；无法可靠恢复的字段保留未决，不猜默认值。

# 写回与验证

## 字幕渲染

调用 `generateFiles(bilingual_files)` 后，用 `render({ source, input, translated, bilingual })` 写出与原文件同主名的 ASS，先输出到 `work/` 暂存：`source` 为 `sources/` 中的包目录，`input` 为 `<writeback.input_path>/<file_path>/items.json`，`translated` 与 `bilingual` 为输出路径。

- 包内有 `render.mjs` 时读取检查后改用；字幕只来自写回输入，不从 `asr` 或旧 `translations.json` 重建，未翻译条目如实呈现。
- **视频默认排版**使用白字、黑描边、零投影。对白底部居中，双语原文在前。带 `box` 的画面文字译文优先在原文框下方避让，其次在上方。上下均无空位时优先保证可见。无 `box` 的画面文字译文顶部居中。
- **纯音频默认排版**：按 1920×1080 排版，深色字底部居中，双语译文在上、原文在下（原文字号较小），原译相同只显示一份；长句按画面宽度换行，整体上移不重叠。
- **定制样式**：复制 `render.mjs` 到 `work/` 修改（保持导出签名不变）；需固定时放入工作目录重新打包并按「更新文件」提交。

## 音频双语成片

纯音频在两份 ASS 通过「产物验证」后，默认再生成双语 MP4（独立于工程和 ASS，失败只需重跑本步）：

```js
const { visualize } = await import(new URL('scripts/visualize.mjs', base_url).href);
const result = await visualize({
  source: 包目录,
  bilingual: 双语ASS,
  fonts: ws.fontsDirectory,
  output: 'work/media/<原文件主名>.mp4',
});
```

- `source` 为含 `media.json` 的包目录或工作目录
- 长音频开始前告知耗时，多个资产依次串行生成。
- 原文件缺失时在工作目录副本中 `relink` 后重跑，仍无法取得则先交付两份 ASS 并说明，无对白纯音乐也可生成（字幕为空）。


# 交付说明

- **目录布局**：单语目录放译文 ASS，双语目录放双语 ASS 与双语 MP4，保留资产相对路径，文件生成成功后无需再次验证内容。
- **使用提示**：视频字幕与原视频同名同目录即可自动加载，音频成片已烧录双语字幕，播放成片时需关闭外挂字幕以免叠字。
- **汇报要点**：说明实际采用的识别来源（本地 ASR 需注明未区分说话人）、已执行的核对范围，以及影响使用的例外（如纯音频音轨转为 AAC、未决或未完成项），建议用户播放抽查并用时间点反馈问题。
