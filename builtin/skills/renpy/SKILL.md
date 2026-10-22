---
name: renpy
description: 翻译、审校或分析 Ren'Py 原生游戏（`.rpyc` 编译脚本）前必须首先加载，提供原稿结构与可读视图、条目默认状态、显示文本与程序值的区分、控制符与 `%` 格式串，以及批量翻译后的补漏和检查方法。
---

本技能只提供 Ren'Py 引擎知识，翻译、审校和提交流程按 `translation` 执行。

# 原稿与条目

每个游戏是一个工程资产，条目的 `file_path` 指向整个游戏。导入前已解开 `.rpa` 归档并移出 `.rpy` 源码，原稿只有编译脚本。`sources/<file_path>/` 包含：

|文件|内容|
|---|---|
|`game_files.txt`|准备后游戏目录的完整文件清单，每行一个相对路径，包括图片、音频、字体和 JSON 等数据文件|
|`__metadata__.json`|`profile` 为引擎档案（`version`、`old_substitutions` 等），`common` 为引擎公共界面字符串|
|`game/x.rpyc.rpy`|按原始行号还原的近似脚本，不能编译。编译时丢失的注释写作空行，ATL 写作 `# ATL`，6.99 旧式界面写作 `# legacy screen language`，其余无法还原的语句写作 `# <类名>`|
|`game/x.rpyc.json`|`{ internal_file_path, strings, warnings }`。解析失败的成员只有 `internal_file_path` 和 `error`|

`.rpymc` 按同样规则生成 `x.rpymc.rpy` 和 `x.rpymc.json`。

`strings` 列出成员中全部可写回的字符串，每项为 `{ key, text, usage, line, source_line }`，包括因重定向而不产生条目的字符串。`warnings` 每项为 `{ message, source_line }`，列出不产生条目的位置。

- `line` 是字符串在 `x.rpyc.rpy` 中的实际行，按它读取上下文。6.99 旧式界面、ATL 和自定义语句（如 `layeredimage`）内部的字符串不在近似脚本中，`line` 为 `null`，按 `source_line` 找到所属语句。
- `source_line` 是原始 `.rpy` 的行号，未知时为 `null`。近似脚本按它排布，两者通常相同。同一原始行有多条语句时，例如一段三引号对白拆成的多句，后面的语句在近似脚本中顺延，`line` 随之增大。
- 菜单选项没有自己的行号，`source_line` 取其子块首行的上一行。选项与子块之间有空行或注释时，这个行号会偏前。

## 条目坐标

`item_extra` 中的 `renpy`：

|字段|含义|
|---|---|
|`internal_file_path`|成员路径，公共界面字符串为 `__metadata__.json`|
|`usage`|导入时的用途分类，决定默认状态|
|`key`|与 `strings[].key` 逐字相同，可以按值比较。公共界面字符串的 `key` 是原文|
|`coordinates`、`digest`|写回坐标与原稿摘要，不要修改|

|`usage`|位置|默认状态|
|---|---|---|
|`say`|对白，以及 `renpy.say` 的第 2 个参数|`NONE`|
|`menu`|菜单标题与选项|`NONE`|
|`display`|代码和界面中的显示参数，见「默认状态」|`NONE`|
|`paragraph`|`_p()` 段落文本|`NONE`|
|`string`|`translate None strings` 的 `new`，即基础语言字符串表|`NONE`|
|`common`|引擎公共界面字符串中尚未出现在基础语言字符串表的部分|`NONE`|
|`code`|其余代码与界面字面量|`RULE_SKIPPED`|

# 默认状态

字面量必须是参数的完整值，或 `%` 运算的左操作数，才按参数判为 `display`。位于列表、字典或其他调用中的字面量为 `code`。

|位置|判定|
|---|---|
|`_`、`__`、`___` 的第 1 个参数|`display`|
|`Character`、`Text`、`Notify`、`Confirm`、`renpy.notify`、`renpy.input` 的第 1 个参数，或对应的 `name=`、`text=`、`message=`、`prompt=`|`display`|
|任意调用的 `what=`、`tooltip=`、`alt=`、`prompt=`，例如 `narrator.add_history(what="…")`|`display`|
|`define config.name`、`config.window_title`、`gui.about` 的整个值|`display`|
|界面 `text`、`textbutton`、`label` 的第 1 个位置参数，以及任意控件的 `text`、`tooltip`、`alt` 属性|`display`|
|6.99 旧式界面中 `text`、`textbutton`、`label`、`Character`、`Text`、`_`、`__`、`___`、`_p` 的第 1 个参数|`display`|
|其他调用的参数，例如 `who=`、`font=`、`kind=`，以及赋值、列表、字典中的字面量|`code`|

以下字符串不产生条目：

- 非基础语言的 `translate` 块与 `translate <语言> strings`。
- f-string 和 `+` 拼接中的字符串，它们列在 `warnings` 中。
- 空字符串。
- `warnings` 中的槽位写回组不完整、共享消费者无法解析等位置。
- 重定向：对白、菜单、显示或段落文本已作为 `old` 出现在 `translate None strings` 中时，引擎显示该表的 `new`。这些位置不产生条目，要翻译对应的 `string` 条目。`strings` 中仍列出它们，所以按 `key` 可能找不到条目。

# 写回粒度

每个条目只改写自己的写回组：

- 对白、菜单和字符串表改写该字段，同一节点被多条语句共享时一起改写。
- 代码字面量只替换引号内的区间，代码结构、变量名和其他字面量保持原样。
- 条目原文在其他语言的字符串表中作为 `old` 时，导出自动以译文为新键生成同一映射，其他语言仍可使用。
- 导出生成 `game/zz_lg_language.rpy` 和 `game/zz_lg_strings.rpy`，前者把游戏固定为基础语言，后者写入公共界面字符串和上述映射。

导出结果只适用于已准备的游戏目录，即归档已解开、源码已移出的目录。

# 控制符与占位符

翻译时须保留：

- 插值整体保留，例如 `[name]`、`[a[0]]`、`[x!t]`、`[n:.2f]`。`[[`、`{{` 表示字面的 `[`、`{`。
- 文本标签整体保留并保持配对，例如 `{b}…{/b}`、`{color=#fff}…{/color}`、`{a=[url]}…{/a}`。
- `{#…}` 是查表上下文，原样保留。

以下规则由导出校验，违反时整个导出失败：

- `say`、`menu`、`display`、`paragraph`、`string`、`common` 条目中的 `[`、`{` 必须闭合。
- `{#…}` 与原文一致，不能增删。
- 字符串是 `%` 运算的左操作数时，译文的记号序列要与原文一致，包括字面百分号 `%%`。`%s`、`%d` 等按位置代入，顺序不能变。含 `%(name)s` 时按名称代入，可以换序。单独的 `%` 必须写作 `%%`。
- `__metadata__.json` 的 `profile.old_substitutions` 为 `null` 时，对白和菜单译文中不能出现 `%`。为 `true` 时，对白和菜单中的 `%` 由导出自动转义，`%(name)s` 保持替换。
- 译文不能含 NUL 字符。

导出不检查插值和文本标签是否与原文一致：`{b}Hello{/b}` 译为 `你好` 也能导出。这类问题只能由文本保护警告和「翻译后检查」发现。文本保护默认保护插值、文本标签和 `%` 格式记号。

# 显示与程序值

按读取该值的代码判断用途。以下都是程序值，保持原文：

- 比较值（`==`、`!=`、`in` 两侧）、字典键、下标 `x["…"]`。
- `persistent.*` 的值、`config.save_directory`、`config.version`、`build.*`。改动 `config.save_directory` 会使玩家找不到旧存档。
- `Jump`、`Call`、`Show`、`Play`、`SetVariable` 等动作的程序参数，`Preference("music volume")` 等设置名。
- 图像标签，例如 `ShowingSwitch("callum sidenormal", …)` 的参数和 `Live2D(tag=…)`。
- 条件表达式字符串，例如 `ConditionClass("AlisonBlaire in Partners")`。
- 资源路径、label 名和 screen 名。

插值变量 `[var]` 的源值只有在全部读取位置都是显示用途时才修改。同文只是搜索线索：原文相同既不证明两处有依赖，也不证明需要同一译文。例如物品名字典 `item_names = {"potion": "Healing Potion"}` 中，键是程序值，值经 `[item_names[x]]` 显示时才是可见文本。

# 可见文本补漏

候选为含源语言文字的 `code` 条目。逐条处理：

1. 按 `strings[].line` 打开 `x.rpyc.rpy` 读取上下文。
2. 在全部 `*.rpyc.rpy` 中搜索读取该值的代码：调用的函数、`screen`、`def` 或类的定义，赋值的变量在何处插值或比较。
3. 按读取结果判定：
   - 显示到界面、对话、提示或历史记录：`显示`，由 Agent 翻译。
   - 用作程序值：`保留`。
   - 找不到读取代码，或用途无法确认：`未决`。

样本中出现过的显示模式，可作为搜索线索：

- 自定义提示，例如 `tt.Action("…")`。
- 字幕或旁白函数的描述参数，例如 `s_play(desc="…")`。
- 短信函数的文本参数，例如 `send_text(…, "…")`、`receive_text(…, "…")`。
- `renpy.save(extra_info="…")` 的存档说明。
- `$ var = "…"` 之后经 `[var]` 显示的文本。
- `define` 中的数据字典和列表，经下标或循环显示。
- `show screen x("…")` 的参数，在 `screen x` 中显示。

# 翻译后检查

译文写入后，用脚本对最新快照批量检查本次写入的条目及其依赖位置：

|检查|方法|处理|
|---|---|---|
|控制符与占位符|读取 `warnings` 数据集中本次条目的 `TEXT_PRESERVE`，再逐条核对插值与文本标签和原文一致，`[`、`{` 闭合，`{#…}` 一致，以及 `%` 左操作数的记号序列|按「控制符与占位符」恢复|
|放行的 `code` 条目|逐条复核读取位置|确认为程序值的恢复：`dst: ""`，`status: "RULE_SKIPPED"`|
|比较值冲突|收集参与比较或查找的条目译文，找出不同原文得到相同译文的情况|调整译文，使它们互相区分|

# 审校检查点

执行「翻译后检查」的全部检查，并按「可见文本补漏」核对 `RULE_SKIPPED` 中的可见文本有无漏译。

# 覆盖缺口

交付时说明以下未覆盖范围：

- 自定义语句 `UserStatement` 的文本在两种情况下不产生条目：6.99 不保存解析结果 `parsed`，以及 `parsed` 中是普通字符串。
- `warnings` 中的位置和动态拼接的文本。
- 投影中有 `error` 的成员。
- 图片中的文字。
- 存档和历史记录中已保存的旧文本，读档后仍显示原文。
- JSON 等脚本以外的数据文件，它们只出现在 `game_files.txt` 中。
- 通过 `RENPY_LANGUAGE` 环境变量指定的语言。
- 可见文本补漏和依赖协调依据静态代码调查，无法证明没有遗漏。建议用户在游戏中抽查，并用截图定位遗漏。
