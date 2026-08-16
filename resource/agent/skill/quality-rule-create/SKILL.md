---
name: quality-rule-create
description: 当需要根据当前工程原文、姓名、已有译文和既有质量规则，主动发现并创建或补充术语与文本保护规则时使用；一次执行共享两个领域的发现前沿与语境信号。替换规则不在本技能范围。
---

# 质量规则创建入口

读取 `@skill(quality-rule-workflow)`，以 `mode: create` 执行其唯一工作流；由该 workflow 按实际范围加载领域判据。同时包含两个领域也只加载一次工作区，并把同一代 probes 合并到一次 items 遍历中。

## 范围

- 泛称“质量规则”或“翻译前规则准备”：处理 glossary + text_preserve。
- 明确“术语、术语表、提取术语表”：只处理 glossary。
- 明确“文本保护、控制符、占位符”：只处理 text_preserve。
- 用户排除的 kind 不进入 probes、facts、决定或变更。
- pre_replacement、post_replacement 与 item 修改只作范围外观察。

创建任务的 facts 只包含当前任务发现的 candidates；existing 规则作为覆盖、冲突、结构聚类和风格证据，不自动变成修改目标。候选已经被既有规则安全覆盖时 discard；需要清理、改写或删除既有规则才能得到理想集合时保留当前可独立创建的精确事实，并把既有规则问题列为范围外审查建议，不借创建任务扩大权限。

## 初始化 probes

从不同文件、章节或结构层读取少量分散样本，只用于选择 seed probes，不能定义扫描范围。seed 必须覆盖所选领域技能的基础发现方向，并至少包含一个不依赖既有规则的方向。可程序定位的 probe 必须完整执行 scope；一次结果放不下时直接流式写入 facts，不能用 Top-N、频率、长度、证据难度或预计动作提前裁掉候选。

同一证据可以启发两个领域：姓名槽位旁的重复标记既可能产生专名 fact，也可能提出占位符 probe；译文残留既可能指向术语，也可能暴露必须原样保留的结构。共享 probe 不表示共享事实，候选仍按领域判据分别决定。

候选决定使用：

- `required`：以 `create` 形成 direct、conditional 或 narrowed 的完整值；
- `not_required`：以 `discard` 保留事实回执，不能在入账前消失；
- 专项下钻和全部表达降级仍失败：对应 fact 单独 blocked，并给出处理建议。

按照共享工作流执行派生代和独立 residual。基础扫描无论发现多少候选都不能直接结束；聚类关系、词根新增匹配、条件分支和正则收窄发现的新形态都必须反馈为 fact 或可执行 derived probe。

最终只从 candidate facts 生成所选 kind 的 creates；没有真实新增时不 apply。对外区分候选总量、discard、create 和 blocked，报告实际 discovery 代数、残差回执、结构组与语义合并数量，不能用最终条目数代替候选召回范围。
