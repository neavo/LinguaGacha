---
name: translation
description: 翻译、补译、重译工程内文本或文档，或检查、审校和修正工程译文时使用。
---

- 用户请求与已有上下文足以确定对象类型和请求类别时，直接读取对应资源，并按其中要求执行。
- 对象类型不明时，按 `ws.contract` 查看指定文件或 `project_meta` 中的文件类型，仅补充区分候选资源所需的事实。足以选择后立即停止初探，读取对应资源。
- 根据实际涉及的对象和操作组合读取多份资源。请求类别仍不明确时，读取对应对象的两份流程。

|对象|翻译、补译、续做与重译|检查、审校与修正|对应文件格式|
|---|---|---|---|
|`pages`|`references/page-translate.md`|`references/page-review.md`|PDF 文件|
|`items`|`references/item-translate.md`|`references/item-review.md`|其他文件格式|
