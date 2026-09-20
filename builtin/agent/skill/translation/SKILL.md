---
name: translation
description: 翻译、补译、重译工程内文本或文档，或检查、审校和修正工程译文时使用。
---

先加载当前可用且尚未加载的写作技能，包括 `writing-guide` 和所有以 `writing-guide-` 开头的技能。随后按任务需要读取资源：

- 用户指令与已有上下文足以确定所需资源时，直接读取并按其中要求执行。
- 任务对象不明时，按 `ws.contract` 查看指定文件或 `project_meta` 中的文件类型，仅补充区分候选资源所需的事实。足以选择后立即停止初探，读取对应资源。
- 任务需要多份资源时，读取后组合使用。

|任务对象|翻译任务|审校任务|对应文件格式|
|---|---|---|---|
|`pages`|`references/page-translate.md`|`references/page-review.md`|PDF 文件|
|`items`|`references/item-translate.md`|`references/item-review.md`|其他文件格式|
