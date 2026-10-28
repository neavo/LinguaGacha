---
name: renpy
description: 翻译、审校或分析 RenPy 游戏前必须首先加载，提供原稿结构与可读视图、条目默认状态、显示文本与程序值的区分、f-string 源码条目、控制符与 `%` 格式串，以及批量翻译后的补漏和检查方法。
---

本技能只提供 Ren'Py 引擎知识，翻译、审校和提交流程按 `translation` 执行。

# 原稿与条目

每个游戏是一个工程资产，条目的 `file_path` 指向整个游戏。导入时解开 `.rpa` 归档并移出 `.rpy` 源码，翻译输入为编译脚本和格式元数据。导入准备未完成时游戏目录保持原样，原稿只包含已读取的成员。`sources/<file_path>/` 包含：

|文件|内容|
|---|---|
|`game_files.reference.txt`|游戏目录的文件清单，每行一个相对路径，包括图片、音频、字体和 JSON 等数据文件。导入时读取失败的文件仍列在清单中|
|`__metadata__.json`|`engine_version` 为引擎版本，`python_major` 为 Python 代际。`old_substitutions` 为百分号语义，`null` 表示未知。`common` 为公共界面字符串，`null` 表示收集不完整。`scripts_incomplete: true` 表示编译脚本有已知遗漏|
|`game/x.rpyc`|编译原件|
|`game/x.rpyc.reference.rpy`|按原始行号还原的近似脚本，不能编译。编译时丢失的注释写作空行，ATL 写作 `# ATL`，6.99 旧式界面写作 `# legacy screen language`，其余无法还原的语句写作 `# <类名>`|
|`game/x.rpyc.reference.json`|`{ internal_file_path, strings }`。解析失败时不生成投影，失败记录在 `source_issues.jsonl`|

`.rpymc` 按同样规则生成 `x.rpymc.reference.rpy` 和 `x.rpymc.reference.json`。

附加原稿的扫描范围是 `game/`，排除 `game/cache/` 与 `game/saves/`。

`strings` 列出成员中全部可写回的字符串，每项为 `{ key, text, usage, write_mode, line, source_line }`，包括因重定向而不产生条目的字符串。`source_issues.jsonl` 中 `stage` 为 `reference` 的记录也包括不产生条目的位置，`message` 给出键或 `文件:行号`。

`strings` 按当前规则从原稿生成。旧工程在重置前可能没有其中部分字符串的条目，只有实际条目列表中的条目才能提交修改。

- `write_mode` 为 `text` 时，`text` 是解码后的文字，导出按所在字段重新编码。为 `source` 时，`text` 是 Python 源码片段，见「源码条目」。
- `line` 是字符串在 `x.rpyc.reference.rpy` 中的实际行，按它读取上下文。6.99 旧式界面、ATL 和自定义语句（如 `layeredimage`）内部的字符串不在近似脚本中，`line` 为 `null`，按 `source_line` 找到所属语句。
- `source_line` 是原始 `.rpy` 的行号，未知时为 `null`。近似脚本按它排布，两者通常相同。同一原始行有多条语句时，例如一段三引号对白拆成的多句，后面的语句在近似脚本中顺延，`line` 随之增大。
- 菜单选项没有自己的行号，`source_line` 取其子块首行的上一行。选项与子块之间有空行或注释时，这个行号会偏前。

## 条目定位

`item_extra` 中的 `renpy`：

|字段|含义|
|---|---|
|`internal_file_path`|成员路径，公共界面字符串为 `__metadata__.json`|
|`usage`|导入时的用途分类，决定默认状态|
|`key`|与 `strings[].key` 逐字相同，可以按值比较。公共界面字符串的 `key` 是原文|
|`digest`|固化原稿摘要，不要修改|

|`usage`|位置|默认状态|
|---|---|---|
|`say`|对白，以及 `renpy.say` 的第 2 个参数|`NONE`|
|`menu`|菜单标题与选项|`NONE`|
|`display`|代码和界面中的显示参数，见「默认状态」|`NONE`|
|`paragraph`|`_p()` 段落文本|`NONE`|
|`string`|`translate None strings` 的 `new`，即基础语言字符串表|`NONE`|
|`common`|引擎公共界面字符串中尚未出现在基础语言字符串表的部分|`NONE`|
|`code`|其余代码与界面字面量、动态片段和源码条目|`RULE_SKIPPED`|

`RULE_SKIPPED` 只由导入写入。放行待翻译时提交 `NONE`，提交译文时使用 `PROCESSED`。

# 默认状态

字面量必须是参数的完整值，或 `%` 运算的左操作数，才按参数判为 `display`。位于列表、字典或其他调用中的字面量为 `code`。

参数外层的运算不影响判定：`_("Hello") + name` 中的 `Hello` 是 `_` 的完整参数，判为 `display`。字面量与参数之间有 `+` 等运算时，它只是运行时文本的片段，判为 `code`：`"Hello " + name` 和 `Text("Hello " + name)` 都产生原文为 `Hello ` 的 `code` 条目。片段在运行时按原顺序拼接，译文须保证拼接后的句子通顺。

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
- f-string 插值内部的字符串，它们属于所在的源码条目。
- 空字符串。
- `source_issues.jsonl` 中的槽位写回组不完整、共享消费者无法解析等位置。
- 重定向：对白、菜单、显示或段落文本已作为 `old` 出现在 `translate None strings` 中时，引擎显示该表的 `new`。这些位置不产生条目，要翻译对应的 `string` 条目。`strings` 中仍列出它们，所以按 `key` 可能找不到条目。

# 源码条目

f-string 产生 `write_mode` 为 `source` 的 `code` 条目，例如 `f"Hello {name}"` 与 `f"Hello"`。隐式拼接中只要有一段 f-string，整个拼接就是一个条目，例如 `"Hello " f"{name}"`。

- `src` 与 `dst` 都是完整的 Python 源码片段，导出把 `dst` 原样替换回原位置。
- 只翻译字面文字。前缀、引号、转义、插值表达式、`!r` 等转换和 `:>10` 等格式说明保持原样，插值的求值结果和次数不能改变。
- 导出不检查源码语法。引号未闭合或表达式被改动时，游戏加载脚本时报错或运行出错。
- 这类条目含源码，不属于只含显示文字的条目，按 Agent 翻译处理。

# 写回粒度

导出校验 `digest`、`key` 和原文后，从固化原稿重建该条目的完整写回组：

- 对白、菜单和字符串表改写该字段，同一节点被多条语句共享时一起改写。
- 代码字面量按完整字面量区间写回，保留区间外的代码。
- 条目原文在其他语言的字符串表中作为 `old` 时，导出自动以译文为新键生成同一映射，其他语言仍可使用。
- 导出生成 `game/zz_lg_language.rpy` 和 `game/zz_lg_strings.rpy`，前者在本次导出后的首次启动重置语言偏好。后者写入公共界面字符串和上述映射。

导出结果只适用于已准备的游戏目录，即归档已解开、源码已移出的目录。

# 控制符与占位符

翻译时须保留：

- 插值整体保留，例如 `[name]`、`[a[0]]`、`[x!t]`、`[n:.2f]`。`[[`、`{{` 表示字面的 `[`、`{`。
- 文本标签整体保留并保持配对，例如 `{b}…{/b}`、`{color=#fff}…{/color}`、`{a=[url]}…{/a}`。
- `{#…}` 是查表上下文，原样保留。
- 字符串是 `%` 运算的左操作数时，译文的记号序列要与原文一致，包括字面百分号 `%%`。`%s`、`%d` 等按位置代入，顺序不能变。含 `%(name)s` 时按名称代入，可以换序。单独的 `%` 必须写作 `%%`。
- 放行调用 `.format()` 的程序字符串时，`{0}`、`{name}` 等格式字段保持原样，字面的 `{`、`}` 写作 `{{`、`}}`。

导出按以下规则处理 `%` 与 NUL，违反时当前游戏资产导出失败：

- `__metadata__.json` 的 `old_substitutions` 为 `null` 时，对白和菜单译文中不能出现 `%`。为 `true` 时，对白和菜单中的 `%` 由导出自动转义，`%(name)s` 保持替换。
- 译文不能含 NUL 字符。

导出不检查插值、文本标签、`{#…}` 和 `%` 记号：`{b}Hello{/b}` 译为 `你好` 也能导出，`%` 记号不匹配会让游戏在运行时抛出异常。这类问题只能由文本保护警告和「翻译后检查」发现。文本保护默认保护插值、文本标签和 `%` 格式记号。

# 显示与程序值

按读取该值的代码判断用途。以下都是程序值，保持原文：

- 比较值（`==`、`!=`、`in` 两侧）、字典键、下标 `x["…"]`。
- `persistent.*` 的值、`config.save_directory`、`config.version`、`build.*`。改动 `config.save_directory` 会使玩家找不到旧存档。
- `Jump`、`Call`、`Show`、`Play`、`SetVariable` 等动作的程序参数，`Preference("music volume")` 等设置名。
- 图像标签，例如 `ShowingSwitch("callum sidenormal", …)` 的参数和 `Live2D(tag=…)`。
- 条件表达式字符串，例如 `ConditionClass("AlisonBlaire in Partners")`。
- 资源路径、label 名和 screen 名。
- 只拼出路径、键或数值的 f-string，例如 `f"images/{name}.png"`、`f"{count}"`。

插值变量 `[var]` 的源值只有在全部读取位置都是显示用途时才修改。同文只是搜索线索：原文相同既不证明两处有依赖，也不证明需要同一译文。例如物品名字典 `item_names = {"potion": "Healing Potion"}` 中，键是程序值，值经 `[item_names[x]]` 显示时才是可见文本。

# 可见文本补漏

候选为含源语言文字的 `code` 条目。逐条处理：

1. 按 `strings[].line` 打开 `x.rpyc.reference.rpy` 读取上下文。
2. 在全部 `*.rpyc.reference.rpy` 中搜索读取该值的代码：调用的函数、`screen`、`def` 或类的定义，赋值的变量在何处插值或比较。
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
|控制符与占位符|读取 `warnings` 数据集中本次条目的 `TEXT_PRESERVE`，再逐条核对插值与文本标签和原文一致，`[`、`{` 闭合，`{#…}` 一致，`%` 左操作数的记号序列，以及 `.format()` 的格式字段|按「控制符与占位符」恢复|
|源码条目|逐条核对 `write_mode` 为 `source` 的条目，按「源码条目」比对前缀、引号、转义、插值表达式和格式说明|按原文恢复源码结构|
|放行的 `code` 条目|逐条复核读取位置|确认为程序值的恢复原文：`dst: ""`，`status: "EXCLUDED"`|

# 审校检查点

执行「翻译后检查」的全部检查，并按「可见文本补漏」核对 `RULE_SKIPPED` 中的可见文本有无漏译。

# 覆盖缺口

交付时按下表检查，只向用户说明本游戏满足条件的项：

|条件|向用户说明|
|---|---|
|`source_issues.jsonl` 有本游戏的记录|涉及的成员和位置，其中的文字可能仍显示原文|
|`__metadata__.json` 的 `common` 为 `null` 或 `scripts_incomplete` 为 `true`|设置、存读档等引擎界面的文字仍显示原文|
|近似脚本中含源语言文字的自定义语句在 `strings` 中没有对应字符串|这些自定义语句的文字仍显示原文|

每次交付都说明：

- 读档后，存档和历史记录中已保存的文本仍显示原文。
- 可见文本补漏和依赖协调依据静态代码调查，无法证明没有遗漏。建议用户在游戏中抽查，并用截图定位遗漏。
