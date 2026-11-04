---
name: project-operation
description: 文件进出工程时使用：把上传文件、本机文件、文件夹或游戏加入工程（包括要翻译、审校但尚未加入的文件），对工程文件整包替换、改名、移动、排序或删除，把工程译文生成并交付给用户。
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
- `file_count` 为零且 `failures` 为空：来源中没有正式支持的文件。用户要求翻译或加入工程时，读取 `generic-data` 完成调查、提取和封装，再识别产出的 `.generic`。仅供参考的材料按参考资料使用。
- `failures` 不为空：按 `message` 向用户说明实际原因。识别失败不等于格式不受支持。含失败项的来源不能提交，先解决失败原因，或改选不含失败项的来源。

## 提交前确认

- 来源含游戏时，提交后应用会准备游戏目录，可能改写其中的文件。提交前用 `ask_user` 确认用户已经备份游戏目录，未确认时不提交。
- Godot 游戏的 `external_pcks` 至少有两个时，列出包名和当前顺序，说明后面的包会覆盖前面包中的同名资源，请用户确认顺序。确认后把完整顺序写入该来源的 `godot_pack_orders`。

应用不记录这两项确认，自动审批也不代表用户已经确认。

新增使用 `creates`。整包替换使用 `updates`，提供 `file_path`、`source_path` 及适用的 `godot_pack_orders`。宿主重建条目并继承译文。替换可同时指定 `sort`。改名另行提交。替换来源须识别为单个资产。解析失败会拒绝整批提交并保留旧资产。需要清空旧译文时使用删除后新增。

## 准备与提交

1. 读取 `project_meta.json`，确认目标资产的 `file_path`。
2. 写入 `creates`、`updates` 或 `deletes`。文件变更单独成批，其他变更留到后续批次。
3. 按系统指令输出提交简报。删除时逐项列出目标，以及其中已翻译的条目数和页数。
4. 调用 `workspace_apply`。

交换两个名称时，借助一个空闲的临时名称，分三个批次依次改名。新资产追加到末尾，需要调整位置时，在后续批次中用更新记录设置 `sort`。

删除简报的统计来自当前快照。已翻译条目指 `status` 为 `PROCESSED` 的条目，已翻译页指 `translation.kind` 为 `translate` 的页面，保留页和省略页不计入。审批界面只显示文件总数，明细由简报说明。

## 回执与恢复

- `inspectSources` 只识别来源，不能证明内容解析成功。新增回执 `parse_failed` 中的资产已经加入工程。告诉用户哪些文件解析失败，不说成新增失败。PDF 可能没有条目，但有页面。
- 替换回执 `replaced` 提供实际条目数、页数和继承填充数。读取最新快照确认结果，再按实际资产路径更新知识。
- `invalid_change` 提示 Godot 包集合已变化时，重新识别来源，与用户确认新的完整顺序。
- 错误 `data.committed_sync_failed` 时，先重读工程确认已生效的文件变更，避免重复提交。

## 生成与交付

1. 按 `project_meta.json` 的 `files` 中的 `file_type` 加载对应的格式技能。有 `GENERIC` 时加载 `generic-data`。
2. `counts.items_with_warnings` 大于零，且用户本次尚未决定是否审校、本对话也未完成审校时，用 `ask_user` 询问。第一项为直接生成，第二项为先审校再生成。选择审校时加载 `translation`。完成审校后继续。
3. 提交本次交付所需的工程变更。再调用 `@lg/project` 的 `generateFiles()`。
4. 有 `GENERIC` 时，按 `generic-data` 用 `generic_input_path` 中的写回输入还原目标格式。写回输入属于工作材料，不放入成果。
5. 对照 `files` 核对原生产物与通用写回成果的完整集合。路径重叠时结合真实加载方式安排合并。用户要求打包时，打包核对后的成果。
6. 确定交付目录：
   - 用户指定了位置时，调用 `getOutputPaths(该目录)`。
   - 否则调用 `getOutputPaths()`。`manual` 为 `true` 时用 `ask_user` 询问。第一项为留在工作区，第二项为写入返回的 `translated_path`。用户输入的自定义内容作为父目录。再调用 `getOutputPaths(该目录)`。
   - 选择留在工作区或取消时，在工作区交付。
7. 需要写入工作区外时，把成果写入 `translated_path`，双语对照写入 `bilingual_path`。目标已存在时，沿用已选父目录重新调用 `getOutputPaths` 取得新路径。只写入已核对的成果。
8. 说明交付位置、格式技能要求的交付说明、验证结果和未完成范围。生成或写入失败时，检查已完成的文件再补齐缺口。把失败残留和写回输入标为工作材料。
