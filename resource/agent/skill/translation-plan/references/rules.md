# 翻译计划规则库

本文件是 `translation-plan` 的唯一规则来源。

规则的中间效果只允许：

- `translate`：独立翻译；
- `skip`：无需翻译；
- `reuse_candidate`：进入复用审查；
- `review`：需要按当前项目语境形成临时决定。

最终每个候选只能成为 `translate`、`skip` 或 `reuse`。规则无法证明 skip 或 reuse 时使用 `DEFAULT-TRANSLATE`。

## 候选与字段

### SCOPE-CANDIDATE

- 先应用用户明确指定的范围。
- 只处理已有稳定 `item_id`；不从 sources 创建 item。
- 原状态为 `PROCESSED` 或 `ERROR` 的 item 不进入候选。
- 其余状态统一投影为 `NONE`，原状态冻结前不得读取。
- 候选判断只使用源字段、project_meta、当前格式事实、必要上下文与本规则库。

### FIELD-SOURCE

- 分别检查 `src` 与可见 `name_src`。
- 任一源字段需要翻译，整个 item 即需要翻译。
- 只有全部源字段都无翻译价值时，item 才能 skip。
- 一个字段的 skip 依据不能自动传播到另一个字段。
- 多行字段逐行判断；任意一行存在可见正文，字段不能因其它行是引用或控制结构而整体 skip。

## 确定性内容

### CONTENT-EMPTY

字段去除 Unicode 空白后为空，判定该字段无翻译价值。全部源字段都为空时 `skip`。

### CONTENT-NON-TEXT

字段只由 Unicode 空白、数字、标点、符号或组合标记组成时无翻译价值。全部源字段均如此时 `skip`。

代表样例：`12345`、`……`、`!!!`、`・･ー`。

### CONTENT-MACHINE

完整字段被当前格式证明确实是 UUID、长哈希、内部数值 ID、变量引用、控制表达式、颜色值或坐标等机器值时 `skip`。普通短词、`snake_case`、`camelCase`、`UPPER_CASE`、`Word123`、`EV001` 只能进入 `review`；无法证明是内部标识时 `translate`。

### CONTENT-CONTROL

- 只有当前 `text_type` 或格式事实确认的控制语法独占字段时才 `skip`。
- 不得全局假定所有 `{...}`、`[...]`、反斜线序列都是控制代码。
- 控制语法与可见正文混合时 `translate`，并保留控制语法。

### CONTENT-SHORT

长度、单词数或字符数从不构成 skip 理由。`Start`、`Save`、`HP`、`はい`、`出口` 都默认可能是可见文本。

## 引用与路径

### REFERENCE-TYPES

以下扩展名只用于识别可能的资源引用，不直接决定 skip：

```text
audio:  .mp3 .wav .ogg .mid .flac .opus
video:  .avi .mp4 .webm .mkv
image:  .png .jpg .jpeg .gif .psd .webp .heif .heic .bmp
font:   .ttf .otf .woff .woff2
data:   .txt .json .sav .mps
archive:.7z .gz .rar .zip
```

识别大小写不敏感；未知扩展名不妨碍一个结构明确的纯路径被识别。

### REFERENCE-ONLY

字段整体是明确文件名、资源路径、绝对或相对路径、URL、URI 或邮箱，且没有自然语言正文时 `skip`。

代表样例：`audio/bgm/theme.ogg`、`MapData/Map001`、`../images/title.png`、`https://example.com`。

### REFERENCE-WITH-TEXT

自然语言正文中包含引用时 `translate`，引用本身保留。不得用 `endsWith(extension)` 或 `includes(extension)` 直接跳过整个字段。

代表样例：`请打开 data/config.json`、`Visit https://example.com for help`。

### REFERENCE-MULTILINE

多行字段只有在全部非空行都是纯引用时才可 skip；任意一行存在正文即 `translate`。

## 语言

### LANGUAGE-ALL

`source_language = ALL` 时不按语言特征分组或跳过。

### LANGUAGE-SCRIPT

Unicode Script 只提供字符体系证据，不是自然语言识别：ZH、JA、KO 共享汉字；所有拉丁语系共享 Latin；少量源语言字符不能证明整段语言。

### LANGUAGE-VISIBLE

- 包含源语言正文支持 `translate`。
- 缺少源语言字符不得直接 skip；英文 UI、专名或第三语言可见文本仍应翻译到目标语言。
- 混合语言默认 `translate`。
- 只有结合语义和项目上下文证明文本已经是完整目标语言且无需本地化时才可 skip。
- 角色名、技能名、地点名、UI 标签和品牌名不按 Script 直接裁决。

## 通用格式原则

### FORMAT-DEFAULT

解析器已经生成 item，说明它具有稳定身份和写回位置。除非其它规则证明无需翻译，否则默认 `translate`。文件格式本身不是跳过理由；无法取得所需格式事实时也默认 `translate`。

### FORMAT-FACTS

格式规则只使用当前 item 的 `file_type`、`text_type`、`tag`、`extra_field` 或与该 item 稳定关联的定点 source 证据。事实缺失时使用 `FORMAT-DEFAULT`，不得把一个格式的判断扩散到其它格式。

## TXT

### TXT-VISIBLE

TXT 没有额外跳过规则；非空字段按通用规则判断，无法证明无需翻译时 `translate`。

## Markdown

### MD-FENCE

完整 fenced code block 的围栏与内容默认 `skip`。用户明确要求翻译代码注释或示例时可以覆盖。

### MD-INLINE-CODE

行内代码保留，周围自然语言正文 `translate`。

### MD-IMAGE

Markdown 图片的 URL 保留；alt 文本或周围正文存在时 `translate`；alt 为空且没有其它正文时 `skip`。

### MD-LINK

Markdown 链接的显示文本与周围正文 `translate`，URL 保留。

### MD-STRUCTURE

标题、列表、引用、表格、强调和 HTML 标签本身不构成 skip 理由。去除结构标记后仍有正文时 `translate`；只有结构标记而没有可见正文时 `skip`。

## SRT 与 ASS

### SRT-VISIBLE

解析器生成的非空字幕正文默认 `translate`；样式标签保留。

### ASS-CONTROL

ASS 的 override 标签和 `\\N` 保留。去除控制部分后存在正文即 `translate`；控制语法独占字段或空结构行 `skip`。

## EPUB

### EPUB-VISIBLE

解析器生成的 OPF 标题、正文、目录、导航文字和 ruby 去注音内容默认 `translate`。不得按 `.opf`、`.ncx`、`.xhtml` 等容器成员后缀跳过。

## XLSX 与 WOLF XLSX

### XLSX-VISIBLE

普通 XLSX 的非空源字段默认 `translate`。表头、分类名、字段名、行号或短文本都不是自动跳过理由；只有格式确认的公式或机器值使用 `CONTENT-MACHINE`。

### WOLFXLSX-VISIBLE

WOLF XLSX 候选同样按通用规则处理。填充色不进入计划判断；无法取得其它结构证据时默认 `translate`。

## KVJSON

### KVJSON-VISIBLE

KVJSON 的非空 key 默认 `translate`；工程文件是 JSON 不意味着 key 是资源路径。多行包含关系只进入 `MTOOL-CONTAINMENT`。

## MESSAGEJSON 与 KAG

### MESSAGEJSON-VISIBLE

解析器生成的 message 和可见姓名默认可翻译。message 为空但 `name_src` 非空时仍需翻译姓名。

### KAG-CONTROL

KAG 控制代码保留；与正文混合时 `translate`，控制代码独占字段时 `skip`。

## Ren'Py

### RENPY-VISIBLE

Ren'Py 解析器已经完成安全槽位选择，候选默认 `translate`。角色显示名默认可翻译；只有 source 证据证明是内部 speaker token 时才跳过姓名。

### RENPY-CONTROL

Ren'Py 标签与插值保留；与正文混合时 `translate`。格式确认的纯控制标签可以 `skip`。纯 `{image=...}`、纯 `{#...}` 等特殊标记进入 `review`：只需原样保留时 skip，与正文组合时 translate，绝不自由改写标记。

## TRANS 公共规则

以下规则只在 `extra_field` 或定点 source 事实能稳定关联当前 item 时适用。TRANS 的颜色标签读取 `extra_field.tag`，不是顶层 `tag`。

### TRANS-FORCE

`extra_field.tag` 精确包含 `aqua` 时 `translate`。

### TRANS-COLOR

`extra_field.tag` 精确包含 `red` 或 `blue` 时默认 `skip`。用户明确要求可以覆盖；`TRANS-FORCE` 高于本规则。

### TRANS-GOLD

`gold` 不表达用户意图，禁止作为判断依据。

### TRANS-CONTEXT

同一 item 有多个 context 时，任一 context 被证明玩家可见，item 即 `translate`；只有全部 context 均被证明内部使用时才可 `skip`。资源引用统一使用 `REFERENCE-*`，不维护 TRANS 私有扩展名黑名单。

### TRANS-ADDRESS

address 结构只作为 `review` 分组信号，不直接形成决定。

## RPG Maker TRANS

### RPGMAKER-GROUPS

以下结构分别形成 `review` 组：`*.js` 文件、MZ Plugin Command 非 text 字段、包含 `filename` 的 address、`/events/{id}/name`、`Tilesets/{id}/name`、`MapInfos/{id}/name`、`Animations/{id}/name`、`CommonEvents/{id}/name`。

每组读取代表项、边界项和邻近上下文：被证明是编辑器标识、资源引用或内部命令时 skip；可能进入玩家界面时 translate；样本不一致时不得整组 skip。MZ Plugin Command 的 text 字段默认可见；`filename` 仍须按引用内容判断。

## WOLF TRANS

### WOLF-VISIBLE

以下 address 默认是可见内容候选：`/Database/stringArgs/0`、`/CommonEvent/stringArgs/{非零}`、`/CommonEventByName/stringArgs/{非零}`、`/Message/stringArgs/{数字}`、`/Picture/stringArgs/{数字}`、`/Choices/stringArgs/{数字}`、`/SetString/stringArgs/{数字}`、`/StringCondition/stringArgs/{数字}`。存在正文时 `translate`，无正文仍可按通用规则 skip。

### WOLF-INTERNAL

确认属于 `/Comment/stringArgs/` 或 `/DebugMessage/stringArgs/` 的内容默认 `skip`。

### WOLF-AMBIGUOUS

以下结构进入项目级 `review`：`/Database/stringArgs/{非零}`、`/CommonEvent/stringArgs/0`、`/CommonEventByName/stringArgs/0`、`/name`、`/description`、`common/**`、`DataBase.json/**/value`。不能全局认定 name 或 description 不可见。

### WOLF-DATABASE-RELATION

文本同时出现在内部数据库参数和其它 value 位置时只生成关系证据。只有项目样本证明后者确实是内部复制值时才可 skip。

## 重复与复用

### DUPLICATE-GROUP

`src` 完全相同只生成 `reuse_candidate`。复用还必须证明可见 `name_src` 一致、显示用途一致、`text_type` 或结构等价、控制语义一致且邻近上下文不要求不同译法。

### DUPLICATE-SCOPE

同文件不能证明可复用，跨文件也不能证明不可复用；文件位置只是证据。`PROCESSED` 不属于候选，不得成为 reuse source。相似文本、包含关系、大小写不同、空白不同或标点不同不得自动复用。

### DUPLICATE-SOURCE

通过复核的重复组按工程文件顺序、`row_number`、`item_id` 选择稳定的首个候选为 source；source 进入 translate，其它成员进入 reuse。无法证明语境一致时全部独立 translate。

## MTool 多行包含

### MTOOL-CONTAINMENT

只在同一 KVJSON 文件中检查：一个多行 `src` 与一个单行 `src`，且单行完整等于多行文本某个去除首尾空白的非空行。命中只进入 `review`，不直接 skip 或 reuse。

### MTOOL-REDUNDANT

只有项目证据证明多行条目会覆盖该单行条目、单行不会独立显示且跳过不会留下未翻译文本，才可形成当前项目的 skip 决定。多行完整译文不是子句译文，不得作为 reuse source；无法证明时两者都 translate。

## 项目级临时判断

### PROJECT-RULE

项目级判断必须来自完整分组，并写明作用范围、精确条件、决定、代表样本和边界反例。它只写入本次 decisions，不自动持久化回本规则库。新稳定模式最多触发一次完整覆盖，之后仍不确定时使用 `DEFAULT-TRANSLATE`。

## 冲突与默认决定

规则优先级从高到低：

```text
1. 候选范围和稳定 item 身份
2. 所有源字段确实为空
3. 用户明确决定
4. 显式格式意图
5. 确定性内容、控制和纯引用规则
6. 当前项目的格式与语义判断
7. 语言证据
8. 重复与包含关系
9. DEFAULT-TRANSLATE
```

### RESOLVE-VISIBLE

任一源字段存在应翻译的可见正文，整个 item 不能被其它字段的 skip 证据带走。skip 必须解释 `src` 与 `name_src` 为什么都无需翻译。

### RESOLVE-REUSE

先完成基础 translate / skip，再处理 reuse。reuse source 必须属于本次 translate，source 与 target 的 `src` 完全相同，不允许链或环。

### RESOLVE-EVIDENCE

决定必须引用规则、结构、样本或上下文；模型自报置信度不是证据。

### DEFAULT-TRANSLATE

无法证明应 skip 时独立 translate；无法证明可以 reuse 时保持独立 translate。
