---
name: project-operation
description: 把上传文件、本机文件、文件夹或游戏加入工程，或用户要求翻译、审校尚未加入工程的文件时使用。也用于工程文件的改名、移动、排序和删除。
---

# 工程文件操作

工程文件的清单和顺序在 `project_meta.json` 的 `files` 中，原稿在 `sources/<file_path>`。文件变更写入 `ws.contract.changes.files`，记录结构、命名和排序规则见其 `reference`。

识别来源只读取，`report` 任务也可以执行。

## 识别来源

先用 `@lg/project` 的 `inspectSources` 识别来源。是否可以导入以识别结果为准，不按扩展名或目录结构猜测。

```js
import { inspectSources } from '@lg/project';
const result = await inspectSources(['uploads/novel.txt', 'D:/Games/Demo']);
console.log(JSON.stringify(result, null, 2));
```

上传文件使用 `uploads/` 开头的工作区相对路径，本机文件和文件夹使用绝对路径。结果与输入顺序一致：

|字段|含义|
|---|---|
|`file_count`|可导入的文件数，一个游戏计为一个|
|`contains_game`|来源中有游戏|
|`godot_packs`|每个 Godot 游戏的 `game_root`、`game_name` 和当前 `external_pcks`|
|`failures`|识别失败的路径和原因|

按结果处理：

- `file_count` 大于零且 `failures` 为空：可以加入工程。
- `file_count` 为零：来源中没有可导入的文件。告诉用户，按参考资料处理。
- `failures` 不为空：按 `message` 向用户说明实际原因。识别失败不等于格式不受支持。含失败项的来源不能提交，先解决失败原因，或改选不含失败项的来源。

## 提交前确认

- 来源含游戏时，提交后应用会准备游戏目录，可能改写其中的文件。提交前用 `ask_user` 确认用户已经备份游戏目录，未确认时不提交。
- Godot 游戏的 `external_pcks` 至少有两个时，列出包名和当前顺序，说明后面的包会覆盖前面包中的同名资源，请用户确认顺序。确认后把完整顺序写入该来源的 `godot_pack_orders`。

应用不记录这两项确认，自动审批也不代表用户已经确认。

加入新版来源会新增资产，不会替换同名旧文件，也不会继承旧文件的译文。用户需要用新版原稿替换旧文件并保留译文时，告诉用户在工作台使用同名替换。

## 准备与提交

1. 读取 `project_meta.json`，确认目标资产的 `file_path`。
2. 写入 `creates`、`updates` 或 `deletes`。文件变更单独成批，其他变更留到后续批次。
3. 按系统指令输出提交简报。删除时逐项列出目标，以及其中已翻译的条目数和页数。
4. 调用 `workspace_apply`。

交换两个名称时，借助一个空闲的临时名称，分三个批次依次改名。新资产追加到末尾，需要调整位置时，在后续批次中用更新记录设置 `sort`。

删除简报的统计来自当前快照。已翻译条目指 `status` 为 `PROCESSED` 的条目，已翻译页指 `translation.kind` 为 `translate` 的页面，保留页和省略页不计入。审批界面只显示文件总数，明细由简报说明。

## 回执与恢复

- `parse_failed` 中的资产已经加入工程。告诉用户哪些文件解析失败，不说成新增失败。PDF 可能没有条目，但有页面。
- `invalid_change` 提示 Godot 包集合已变化时，重新识别来源，与用户确认新的完整顺序。
- 错误 `data.committed_sync_failed` 时，已生效的新增和删除不再提交。
