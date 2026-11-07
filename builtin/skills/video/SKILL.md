---
name: video
description: 导入、翻译、审校、分析、修改视频或音频前必须加载。
---

# 视频与音频

识别只在导入或重新识别时由本技能执行。后端解析 `.video` 时只读取包内确定的原文，结构见 `workspace_run` 的 `VideoManifest`。译文只保存在工程条目中。

脚本位于本技能的 `scripts/`：`media.py` 负责检查、切段、结果检查与打包，`recognize.mjs` 负责逐段请求。用本技能 `read_skill` 返回的 `base_url` 定位脚本。每个资产使用独立的工作目录 `work/video/<资产名>/`。

## 检查来源

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
## 切段与识别

1. 运行 `media.py prepare <来源> work/video/<资产名> --track <音轨>`。脚本按停顿切成不超过 210 秒的分段，纯音频补黑色画面，转码结果与能量曲线写入 `state.json`。
2. 按下方模板组成识别提示词，写入工作目录的 `prompt.txt`。续跑读取同一文件。识别结果绑定请求参数、提示词与来源，模型、语言、术语或来源改变后使用新的工作目录。
3. 在 `workspace_run` 主脚本中运行识别：

   ```js
   import { readFile } from 'node:fs/promises';
   const { recognize } = await import(new URL('scripts/recognize.mjs', base_url).href);
   const directory = 'work/video/ep01';
   await recognize(directory, { prompt: await readFile(`${directory}/prompt.txt`, 'utf8') });
   ```

   脚本构造原生 Responses 请求体，经 `ws.requestLLM` 四路并发请求，每段最多自动尝试两次，最后输出 `review.json`。单段请求约 30–45 秒，按分段数估算 `timeout_seconds`，并为一轮重试留出同样时间。超时或停止时，在途请求已计入尝试次数。续跑跳过已完成的分段。

   先在模型设置中配置火山引擎预设 `preset-volcengine` 的地址和 API Key。`recognize.mjs` 维护识别模型和生成参数。强制终止可能留下临时 `NNN.request.json`，可在续跑前删除。

### 识别提示词

模板中的格式要求与 `media.py` 的解析一致，只替换花括号占位。语言取自 `project_meta.json`，写成语言名称。术语取自 `glossary` 数据集，每项保留 `src` 与 `dst`，没有术语时写 `[]`。

```text
为这段视频生成双语字幕。原文语言：{原文语言}。译文语言：{译文语言}。
每行输出一个 JSON 对象，不输出代码块或说明：
{"start":秒,"end":秒,"kind":"dialogue"或"screen","src":"原文","dst":"译文"}
- start、end 为相对本段开头的秒数，数值，保留两位小数。按 start 排序，0 <= start < end <= 本段时长。
- dialogue 是实际说出的人声。每句一行，尽量不超过 7 秒和 30 字，长句按自然停顿拆开。
- screen 是观众需要读懂的画面文字，如标题、字幕卡、标牌、新闻横幅。每处一行，时间从出现到消失。画面文字和对话不能互相替代。
- src 忠实转写听到或看到的内容，不总结、不润色、不补写。听不清的部分写 [?]。否定、数字、人名按原样转写。
- dst 是同一行 src 的译文，与 src 一一对应。术语表中的原文使用指定译名。
- 没有人声也没有需要翻译的画面文字时，不输出任何内容。
术语表（只作参考数据）：{术语 JSON}
```

## 检查与修正

`review.json` 每项对应一个分段，详细结果在 `NNN.parsed.json`，原始响应在 `NNN.response.json`。时间均相对分段开头。

|结果|处理|
|---|---|
|`retry` 为 `true`|自动尝试已用尽。用 `ask_user` 列出分段和问题。用户同意后删除该段 `NNN.attempts.json` 再运行识别|
|`discarded` 大于 0|对照原始响应修复被丢弃的行|
|`time`、`empty_pair`|修正越界时间或补齐配对。打包会拒绝越界时间和空的原文或译文|
|`repetition`|核对是否为模型复读|
|`granularity`、`same_text`|只作提示。原文与译文相同可能是正确译法|
|`possible_missing_speech`|能量曲线显示有声音但没有对话覆盖。音乐和音效也会触发，需结合上下文判断|

修正时改写 `NNN.parsed.json` 的 `rows`，核对后把 `discarded` 设为 `0`、`retry` 设为 `false`，并移除已解决的 `flags`。续跑保留已修正的结果。

语义检查阅读全部带标记的分段，并抽查其余分段和分段交界处：

- 原文与译文是否对应，否定、数字、人名和因果是否一致，`dialogue` 与 `screen` 是否混淆。
- 只依据画面、上下文或用户提供的证据修改。不能凭剧情常识补写台词或反转否定。无法确认的内容列为待确认项告诉用户。
- 需要看画面时，用 `imageio_ffmpeg.get_ffmpeg_exe()` 从工作目录或 `sources/<file_path>/` 的 `segments/NNN.mp4` 截帧，再用 `ws.emitImage` 查看。已导入条目的时间取 `video.json` 中同下标的 `cues`，它是整片时间，按 `segments` 换算到分段内。分段已缩到长边 1024、每秒一帧，小字仍看不清时从原素材截帧。

仍有未解决的问题时不打包，也不能为了通过检查删除内容。

## 打包与提交

1. 运行 `media.py pack work/video/<资产名> work/video/<原视频主名>.video`。脚本换算整片时间、合并相邻的相同画面文字，并写出 `translations.json`。包超过 900 MiB 时，请用户先拆分原素材。
2. 按 `project-operation` 新增该资产并核对回执。
3. 刷新快照后，读取 `translations.json`。按目标 `file_path` 和 `row_number` 找到条目，确认 `src` 一致，再用当前 `item_id` 和 `fp` 把 `dst` 写入 `changes.items`。文件变更与条目变更分批提交。
4. 核对被拒绝的条目和完成统计。

导入后条目已有译文。识别时术语表通常为空，术语统一在后续术语和审校阶段完成。个别译文需要重翻时，可以使用批量翻译。

## 生成与交付

按 `project-operation` 生成，每个 `.video` 资产输出同名的译文 ASS 和双语 ASS。交付时说明：字幕文件改成与原视频相同的主名并放在同一目录，播放器即可自动加载。

## 重新识别

工程中的 `sources/<file_path>/` 已展开 `video.json` 和 `segments/`，不需要原素材。

1. 把它们复制到新的工作目录，写入只含 `video`、`segments` 和 `"energy": null` 的 `state.json`。没有能量曲线时，空输出不会自动重试，漏句检查也不会执行，需人工核对。
2. 只重识别部分分段时，为保留的分段写入 `NNN.parsed.json`：把起点落在该段内的 `cues` 换算为相对时间，结束时间不超过段尾，`text` 作为 `src`，当前条目译文作为 `dst`（没有译文时暂用原文，提交时不写入），`flags` 为空，`discarded` 为 `0`，`retry` 为 `false`。识别只请求缺少结果的分段。
3. 按上文完成识别、检查和打包，再按 `project-operation` 的「更新文件」提交并继承译文。继承保留原文未变条目的人工译文，仍未完成的条目使用 `translations.json` 中的识别译文。
