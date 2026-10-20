---
name: godot
description: 翻译、审校或分析 Godot 4 游戏前必须首先加载，提供原稿结构与可读视图、条目默认状态、语言表、代码依赖，以及批量翻译后的补漏和检查方法。
---

本技能只提供 Godot 引擎知识，翻译、审校和提交流程按 `translation` 执行。

# 原稿与条目

每个游戏是一个工程资产，条目的 `file_path` 指向整个游戏。`sources/<file_path>/` 只包含以下成员，其余资源不在其中：

|成员|内容|附加投影|
|---|---|---|
|`project.binary`|工程设置|`project.binary.json`|
|`.gdc`|编译后的 GDScript|`x.gdc.gd` 还原脚本，`x.gdc.json`|
|`.gd`|GDScript 源码|无，原文可读。解析失败时写出错误投影 `x.gd.json`|
|`.scn`、`.res`|二进制场景 `PackedScene` 或自定义资源 `Resource`|`x.scn.json`、`x.res.json`|
|`.translation`|语言表，全部 locale|`x.translation.json`|
|`.po`|PO 语言表|无，原文可读。解析失败时写出错误投影 `x.po.json`|

候选按扩展名发现，不区分大小写。二进制成员按文件头识别：`GDSC` 是编译脚本，`RSRC`、`RSCC` 按资源 `type` 区分语言表和其他资源，例如 `.res` 也可能是语言表。投影文件名在成员路径后追加 `.json` 或 `.gd`。

路径对应关系：

- 导出的场景通常位于 `.godot/exported/<编号>/export-<哈希>-<名称>.scn`，代码和 `external` 中引用的是原始路径 `res://…/<名称>.tscn`，按名称对应。
- 编译脚本保留原路径，只把扩展名 `.gd` 换成 `.gdc`。代码和 `external` 中仍写作 `res://…/x.gd`。

`sources/<file_path>/game_files.txt` 每行列出游戏目录中的一个文件路径，路径相对游戏根目录。PCK 已在导入前展开，清单包含全部资源，例如图片、音频、`.remap`、`.import` 和 JSON、CSV 等自定义数据文件。较早导入的工程没有该文件。

## 投影

投影都是 JSON，统一结构如下，解析失败的成员只有 `internal_file_path` 和 `error`：

|字段|含义|
|---|---|
|`internal_file_path`|成员路径|
|`type`|`GDSC`、`PackedScene`、资源类名、`OptimizedTranslation`、`Translation`、`TranslationPO` 或 `ProjectSettings`|
|`strings`|该成员中全部可写回的字符串位置，包括不产生条目的字符串。每项为 `{ location, text, context }`|

按类型的正文：

|类型|正文字段|`context`|
|---|---|---|
|`GDSC`|无，源码在 `x.gdc.gd`|`line N`，即 `x.gdc.gd` 的第 N 行|
|`PackedScene`|`external` 外部资源，`resources` 内部资源，`nodes[]` 为 `{ path, type, instance, groups, properties }`，`connections[]` 为 `{ from, signal, to, method }`|`<节点路径>:<属性>`|
|资源|`external`，`resources[]` 为 `{ path, class, properties }`|`<类名>.<属性>`|
|语言表|`locale`，`selected` 表示是否为本次翻译的表|消息键，无法还原时为 `null`|
|`ProjectSettings`|`settings` 为全部设置，`translation` 为 `{ fallback, locale, tables }`|无 `strings`|

节点路径相对场景根，根节点为 `.`。实例化节点的 `type` 为 `null`，`instance` 指向被实例化的场景。

属性值中的非 JSON 类型：

|写法|含义|
|---|---|
|`{ "$string_name": "…" }`|`StringName`|
|`{ "$node_path": "a/b:prop" }`|`NodePath`|
|`{ "$dictionary": [[键, 值], …] }`|字典，键可以不是字符串|
|`{ "$ext": "res://…" }`|外部资源引用|
|`{ "$sub_resource": N }`|内部资源，`N` 是 `resources` 的下标|
|`{ "$type": "VECTOR2" }`|向量、颜色等数值类型，Packed 数组另有 `$length`。`PackedStringArray` 直接写作字符串数组|

`x.gdc.gd` 按原行号还原，注释在编译时已丢失，空格只是近似。行号和字面量与原脚本一致，可以直接搜索。

## 条目坐标

`item_extra` 中的 `godot.location` 与投影 `strings[].location` 的结构完全相同，可以按值比较：

|`kind`|坐标|对应位置|
|---|---|---|
|`gdsc`|`token`|`x.gdc.json` 的 `strings`，`context` 给出行号|
|`scene`|`node`、`property`|`nodes[node]` 的属性，`node` 是 `nodes` 的下标|
|`resource`|`offset`|资源或非优化语言表的 `strings`|
|`slot`|`word`|优化语言表的 `strings`|
|`gd`|`start`、`end`|`.gd` 原文的区间，包含引号|
|`po`|`start`、`end`|`.po` 原文中整个 `msgstr` 字段的区间|

`gd` 和 `po` 的区间是 UTF-16 下标，与 JavaScript 字符串的 `slice(start, end)` 一致。

# 默认状态

`godot.usage` 为 `text` 的条目默认 `NONE`，`code` 默认 `RULE_SKIPPED`。

以下字符串不产生条目：

- 含私有区字符，以 `res://`、`user://`、`uid://` 开头，或形如 `#fff`、`#rrggbbaa` 的颜色值。
- 去掉 `%s` 等格式占位符、`{…}` 和 `[…]` 后没有字母。
- `.gd` 中带 `&`、`^`、`$` 前缀的字面量。
- 自定义 `Resource` 以外的资源，以及资源内嵌的 `GDScript`、`Shader`、`ShaderInclude`、`VisualShader`。
- 未选中 locale 的语言表。

|默认 `NONE`|默认 `RULE_SKIPPED`|
|---|---|
|场景中 `text`、`tooltip_text`、`dialog_text`、`placeholder_text` 属性，包括 `popup/item_N/text` 等列表项|已是选中语言表消息键的字符串|
|`Window`、`AcceptDialog`、`ConfirmationDialog`、`FileDialog`、`Popup` 节点的 `title`|字典键，`==`、`!=`、`in`、`match` 两侧，下标 `x["…"]`|
|编译脚本中对 `text`、`tooltip_text`、`dialog_text`、`placeholder_text`、`title` 的直接赋值|注解和 `assert` 的参数，对 `code`、`source_code`、`expression` 的赋值|
|编译脚本中显示类调用的参数：`tr`、`tr_n`、`atr`、`atr_n`、`set_text`、`set_tooltip_text`、`set_placeholder`、`add_item`、`add_icon_item`、`add_check_item`、`add_radio_check_item`、`set_item_text`、`set_item_tooltip`、`set_tab_title`、`add_text`、`append_text`|编译脚本中代码类调用的参数，例如 `print`、`get_node`、`load`、`connect`、`emit_signal`、`call`、`get`、`set`、`has`、`is_action_pressed`、`add_to_group`、`play`、`change_scene_to_file`|
|选中语言表的全部译文|场景和资源中的 `StringName`|

其余字符串按外观判断：含空白或非 ASCII 字符为 `NONE`，否则为 `RULE_SKIPPED`。

- 调用只认字面量直接所在的括号，位于数组或字典内的字面量按外观判断。
- `.gd` 源码只按字面量两侧的字符识别字典键和比较，显示类和代码类调用都按外观判断。

`NONE` 条目也可能被代码比较或查找，`RULE_SKIPPED` 条目中也可能有玩家可见文本。

# 写回粒度

每个条目只改写自己的位置：

- 编译脚本按 token 追加新常量，同一常量的其他引用保持原文。
- 场景按「节点 + 属性」重定向到新值，其他节点共用的值保持原文。
- 资源、`.gd`、`.po` 和语言表按区间或槽位改写。

游戏用修改后的值比较、查找或持久化时，仍按「依赖协调」处理。

# 语言表

只翻译一种 locale 的语言表：

1. 工程 `fallback` 的 locale 有语言表时，翻译该 locale。`fallback` 未设置时为 `en`。
2. 否则翻译 `internationalization/locale/translations` 登记顺序中第一张表的 locale，导出时把 `fallback` 改为该 locale。
3. 登记了但没有随包发布的表不参与选择。

locale 精确比较，`en` 和 `en_US` 不算匹配。`project.binary.json` 的 `translation` 给出本次结果，语言表投影的 `selected` 与之一致。

未选中的表在投影中作为对照语料。优化语言表只存哈希，`context` 是用脚本、场景、资源中的字符串和其他语言表的消息键反查出的消息键，找不到时为 `null`。

## 消息键判断

先按位置区分，再比较文本：

1. 选中语言表的译文位置正常翻译，即使原文等于消息键。这些位置是 `selected` 为 `true` 的语言表投影中的 `strings`，以及 `translation.tables` 中 `.po` 的 `msgstr` 区间。
2. 代码、场景和其他资源中等于消息键的字符串，按读取代码确认用途。只对确认被误译的消息键引用恢复原文，证据不足时列为未决。

例如语言表 `Start → Start` 中，右侧的 `Start` 是译文，可以译为「开始」。代码中的 `tr("Start")` 使用消息键，保持原文。

# 依赖协调

`NONE` 的原文同时用作比较值、字典键、`match` 分支、下标、存档值或查找键时，只译一处会改变游戏行为：

1. 用原文搜索 `sources/<file_path>/` 下的 `.gd`、`.gdc.gd` 和全部 JSON 投影。
2. 按读取该值的代码，判断每个位置是显示、比较、查找键还是存档值。
3. 需要一起改的位置使用同一译名，通过各自的条目提交。证据不足时列为未决，报告位置和原因。

原文相同不能单独证明存在依赖。不同原文作为比较值或查找键时，不能译成同一个值。

节点名、信号名、分组名、输入动作名和动画名不产生条目，也不要修改。代码中引用它们的字符串条目保持原文。

# 控制符与占位符

默认保护与 `text-preserve` 的 `godot` 预设一致：

- `%s`、`%.2f`、`%-5d` 按位置代入，不能交换顺序，需要换序时只能调整措辞。
- `{name}` 按名称代入，可以随语序移动。
- BBCode 标签如 `[b]`、`[/b]`、`[color=red]` 保持原样。`[img]` 与 `[/img]` 之间的资源路径不受默认保护，也保持原样。

# 可见文本补漏

候选为含源语言文字的 `RULE_SKIPPED` 条目，先按「消息键判断」识别译文位置和消息键引用。找到读取该位置的代码后，按读取结果判定：

|读取结果|判定|
|---|---|
|显示到控件、对话、提示或日志界面|`显示`，由 Agent 翻译|
|用作比较值、字典键、查找键、存档值、节点路径、资源名或语言表消息键|`保留`。与显示位置共用同一原文时，按「依赖协调」处理|
|找不到读取代码|`保留`，记录搜索范围|
|有读取代码，但用途无法确认，例如按动态键读取|`未决`|

`.gdc` 的读取代码在 `x.gdc.gd` 的 `context` 行附近，场景属性的读取代码在挂载脚本中，脚本见节点的 `script` 属性。

# 翻译后检查

译文写入后，对本次写入的条目及其依赖位置执行以下检查，用脚本批量完成：

|检查|方法|处理|
|---|---|---|
|控制符与占位符|读取 `warnings` 数据集中本次条目的 `TEXT_PRESERVE` 和 `LINE_COUNT_MISMATCH`|按「控制符与占位符」恢复|
|名称依赖|对本次写入的条目和补漏的 `显示` 条目，用原文搜索比较、字典键、`match`、下标和查找位置|按「依赖协调」处理，证据不足时列为未决|
|比较值冲突|收集参与比较或查找的条目译文，找出不同原文得到相同译文的情况|调整译文，使它们互相区分|
|语言表消息键|按「消息键判断」核对位置及读取代码|恢复确认被误译的消息键引用：`dst: ""`，`status: "RULE_SKIPPED"`|

# 审校检查点

执行「翻译后检查」的全部检查，并按「可见文本补漏」核对 `RULE_SKIPPED` 中的可见文本有无漏译。

# 覆盖缺口

交付时说明以下未覆盖范围：

- 未选中 locale 的语言表。系统语言或游戏内语言菜单命中这些表时，游戏仍显示其中的原文。
- C# 和 Mono 的 DLL、GDExtension 原生库。
- 文本格式的 `.tscn`、`.tres`，以及 JSON、CSV、对话插件等自定义数据文件，它们只出现在 `game_files.txt` 中。
- 图片中的文字。
- 投影中有 `error` 的成员。
- 可见文本补漏和依赖协调依据静态代码调查，无法证明没有遗漏。建议用户在游戏中抽查，并用截图定位遗漏。
