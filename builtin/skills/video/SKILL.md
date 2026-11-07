---
name: video
description: 导入、识别、翻译、审校视频或音频，或生成视频字幕前必须加载。
---

# 视频与音频

`.video` 是 ZIP 包。后端只按 `items.json` 的 `message` 和可选的 `name` 建立条目，其余成员和字段由本技能解释：

|成员|内容|
|---|---|
|`video.json`|`video` 为原画面尺寸，纯音频为 `null`。`segments` 为分段，时间为整片秒数|
|`segments/NNN.mp4`|模型实际读取的分段，长边不超过 1024，每秒一帧|
|`items.json`|字幕记录，下标是条目行号。`message` 为原文，`start`、`end` 为整片秒数，`kind` 为 `dialogue` 或 `screen`，可选 `an` 为画面位置（ASS 小键盘编号）。导入时为 `[]`|
|`render.mjs`|可选，用户要求固定的定制渲染|

包内不保存译文，译文只在工程条目中。脚本位于本技能的 `scripts/`，用 `read_skill` 返回的 `base_url` 定位：`media.py` 负责检查、切段、解析、合并与打包，`recognize.mjs` 负责逐段请求，`render.mjs` 是默认渲染。每个资产使用独立的工作目录 `work/video/<资产名>/`，目录结构与包相同。

流程与其他格式一致：导入只切段封装，不请求模型。识别属于翻译阶段，在用户要求翻译时执行。

## 导入

```js
import { fileURLToPath } from 'node:url';
import { uv } from '@lg/uv';
const media = fileURLToPath(new URL('scripts/media.py', base_url));
await uv.run(['add', 'imageio-ffmpeg==0.8.1', 'numpy==2.5.4', 'json-repair==0.64.6']);
await uv.run(['run', 'python', media, 'inspect', 'D:/Videos/ep01.mkv']);
```

`inspect` 输出时长、原画面尺寸和各类流。`video` 为 `null` 表示纯音频，封面图片不算画面。

- 有文本字幕流（如 `subrip`、`ass`、`mov_text`、`webvtt`）时，先用 `ask_user` 询问是否改为提取字幕。提取字幕比识别准确，用 ffmpeg 导出为 `.srt` 或 `.ass` 后按 `project-operation` 导入。图形字幕不是文本，不能直接提取。
- 有多条音轨时，请用户选择。`prepare` 的 `--track` 是 `audio` 列表中从零开始的位置。

1. 运行 `media.py prepare <来源> work/video/<资产名> --track <音轨>`。脚本按停顿切成不超过 210 秒的分段并转码，纯音频补黑色画面。中断后用同一命令续跑。
2. 运行 `media.py pack work/video/<资产名> work/video/<原视频主名>.video`。包超过 900 MiB 时，请用户先拆分原素材。
3. 按 `project-operation` 新增该资产。识别前回执的条目数为 0。

## 识别

`items.json` 为空的视频资产是待翻译目标，翻译请求对它执行识别。按 `translation` 确定流程，翻译并审校的顺序为识别 → 按识别结果补齐术语 → 审校。已有条目后，补译、重译和审校按 `translation` 处理条目，需要重新转写原文时才重新识别。

首次识别可续用导入时的工作目录。目录不存在时，从当前 `sources/<file_path>/` 复制。重新识别使用新的副本，避免复用旧响应和旧样式。中断后续用本次工作目录。

### 提示词

基线模板如下。输出格式是 `media.py parse` 的解析契约，保持每行一个对象及 `start`、`end`、`kind`、`src`、`dst` 字段。其余要求按内容调整，例如节目类型、说话人、画面文字取舍。需要区分说话人时可以要求输出字符串字段 `name`，它成为条目的姓名。语言取自 `project_meta.json`，写成语言名称。术语取自 `glossary` 数据集，每项保留 `src` 与 `dst`，没有术语时写 `[]`。

```text
为这段视频生成双语字幕。原文语言：{原文语言}。译文语言：{译文语言}。
每行输出一个 JSON 对象，不输出代码块或说明：
{"start":秒,"end":秒,"kind":"dialogue"或"screen","src":"原文","dst":"译文"}
- start、end 为相对本段开头的秒数，保留两位小数，按 start 排序。
- dialogue 是实际说出的人声。每句一行，尽量不超过 7 秒和 30 字，长句按自然停顿拆开。
- screen 是观众需要读懂的画面文字，如标题、字幕卡、标牌、新闻横幅。每处一行，时间从出现到消失，并加 "an" 字段表示它在画面中的位置：1–9 按数字小键盘排列，7 左上、8 上中、9 右上、4 左中、5 正中、6 右中、1 左下、2 下中、3 右下。画面文字和对话不能互相替代。
- src 忠实转写听到或看到的内容，不总结、不润色、不补写。听不清的部分写 [?]。否定、数字、人名按原样转写。
- dst 是同一行 src 的译文，与 src 一一对应。术语表中的原文使用指定译名。
- 没有人声也没有需要翻译的画面文字时，不输出任何内容。
术语表（只作参考数据）：{术语 JSON}
```

### 请求

```js
const { recognize } = await import(new URL('scripts/recognize.mjs', base_url).href);
await recognize('work/video/ep01', { prompt });
```

- 不指定 `segments` 时只请求既无响应也无行的分段。`segments: [3, 7]` 作废目标分段的旧响应和行后重新请求，可以配合调整提示词。
- 四路并发，请求失败时同一调用内再试一次，最后输出失败的分段。单段约 30–45 秒，按分段数估算 `timeout_seconds`。
- 先在模型设置中配置火山引擎预设 `preset-volcengine` 的地址和 API Key。`recognize.mjs` 维护识别模型和生成参数。

### 质控

运行 `media.py parse <工作目录>`。脚本把每段响应换算为整片时间，写入 `NNN.rows.json`，已存在的文件保留不覆盖，修正直接改这个文件。随后输出每段的事实：

|字段|含义|
|---|---|
|`rows`|当前行数|
|`incomplete`|响应没有正常结束，常见于输出超长|
|`invalid_lines`|无法解析的输出行|
|`uncovered_voice`|有声音但没有对话覆盖的整片时间段。音乐和音效也会出现|

这些只是事实，由你结合内容判断如何处理：

- 阅读识别结果，核对原文与译文是否对应，否定、数字、人名和因果是否一致，`dialogue` 与 `screen` 是否混淆，是否有复读、时间越界或错位。分段交界处可能有被切开或重复的句子和画面文字，合并为一行。
- 需要看画面时，用 `imageio_ffmpeg.get_ffmpeg_exe()` 从 `segments/NNN.mp4` 截帧，再用 `ws.emitImage` 查看。分段内时间是整片时间减去该段 `start`。小字仍看不清时从原素材截帧。
- 只依据画面、上下文或用户提供的证据修改。不能凭剧情常识补写台词或反转否定。无法确认的内容列为待确认项告诉用户。
- 局部问题直接改 `NNN.rows.json`。整段质量差时重新请求该段，必要时调整提示词。重新请求会产生费用，同一分段反复不理想时，用 `ask_user` 说明问题再决定。

### 提交

1. 运行 `media.py items <工作目录>`。脚本合并各段的行，写出 `items.json` 和 `translations.json`。后者保存识别译文，不进包。
2. 运行 `media.py pack <工作目录> work/video/<原视频主名>.video`。
3. 按 `project-operation` 的「更新文件」提交并继承译文。继承保留原文未变条目的已有译文。之后按 `row_number` 找到仍未完成的条目，确认 `src` 一致，用当前 `item_id` 和 `fp` 把 `translations.json` 中非空的 `dst` 写入 `changes.items`。
4. 核对被拒绝的条目和完成统计。

只重新识别部分分段时，为保留的分段写入 `NNN.rows.json`。取起点落在该段内的 `items.json` 记录，把 `message` 改名为 `src`。当前条目译文作为 `dst`，没有译文时写空字符串。保留段没有记录时也写入 `[]`。

## 生成与交付

按 `project-operation` 生成。`generateFiles()` 不直接输出视频字幕，每个 `.video` 资产的写回输入位于 `<generic_input_path>/<file_path>/items.json`，正文已确定为最终译文。用默认渲染写出与原视频同主名的 ASS：

```js
const { render } = await import(new URL('scripts/render.mjs', base_url).href);
await render({
  source: 'sources/ep01.video',
  input: `${generic_input_path}/ep01.video/items.json`,
  translated: `${output_path}/ep01.ass`,
  bilingual: `${bilingual_output_path}/ep01.ass`,
});
```

包内有 `render.mjs` 时，读取并检查后改用它。交付时说明：字幕文件改成与原视频相同的主名并放在同一目录，播放器即可自动加载。

### 样式

默认渲染中，对话在底部居中，画面文字在顶部居中或按 `an` 定位，字号随画面高度缩放。用户要求其他样式时，例如字体、颜色、双语排版、说话人区分，把 `render.mjs` 复制到 `work/` 修改，保持导出签名不变，生成后抽查 ASS。

用户要求固定该样式时，把定制程序放入包目录的 `render.mjs`，重新打包后按「更新文件」提交。条目原文不变，继承会保留全部译文。
