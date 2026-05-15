---
name: project-reivew
description: 只在用户显式调用时触发
---

# Project Reivew

## 核心流程

1. 先停止执行审查，并用序号列表询问用户此次 review 的目标范围。
2. 只询问目标范围，不同时询问其它问题；除非用户主动补充约束，否则不要扩大问题面。
3. 用户选择范围后，读取 `references/review_prompt.md`。
4. 将 `references/review_prompt.md` 的完整内容作为主审查指令原文使用，不要改写、翻译、摘要、删减或重排。
5. 在主审查指令之外，根据用户选择补充最小必要的目标说明与代码定位命令。
6. 执行审查时只输出符合主审查指令要求的结果；若主审查指令要求 JSON，则最终审查结果只输出 JSON。

## 目标范围询问

使用下面的序号列表询问用户：

```text
请选择此次 review 的目标范围：

1. 当前工作区改动（staged、unstaged、untracked）
2. 与指定 base branch 的差异
3. 指定 commit 的改动
4. 指定文件或目录
5. 自定义审查目标
```

## 范围执行规则

- 选择 `1` 时，审查当前工作区所有 staged、unstaged、untracked 改动。
- 选择 `2` 时，要求用户提供 base branch；拿到分支后先计算 merge base，再审查相对该 merge base 的 diff。
- 选择 `3` 时，要求用户提供 commit SHA；审查该 commit 引入的改动。
- 选择 `4` 时，要求用户提供文件或目录；只审查这些路径相关的改动或内容。
- 选择 `5` 时，要求用户提供自定义目标；按用户目标审查。

## 主指令

- 主指令文件：`references/review_prompt.md`
- 必须直接使用该文件原文。
- 不要把主指令复制进对用户的普通解释里，避免无意改写或污染最终审查输出。
