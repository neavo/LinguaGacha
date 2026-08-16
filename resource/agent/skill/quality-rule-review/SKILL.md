---
name: quality-rule-review
description: 当需要审查、校正、删除或整理当前工程中的术语或文本保护规则时使用；以程序化目标清单保证完整覆盖，模型分片核验规则事实并回放涌现信号形成最终集合。需要主动扫描全工程发现新规则时使用 quality-rule-create。替换规则不在本技能范围。
---

# 质量规则审查

先读取并遵循 `@skill(quality-rules)` 与 `@skill(quality-rule-workflow)`；本技能只补充审查现有规则的目标建立、观察与处置流程。

## 范围

- 未限定 kind：审查现有 glossary + text_preserve；限定 kind 时只处理指定类型。
- 限定 targets：只有明确规则进入 existing targets；其它规则只作结构或语义证据。
- 用户排除项保持原样且不进入目标、计数或变更。
- 审查不主动全工程发现新候选；核验目标时发现的必要替代边界或缺失事实可以追加为 candidate target。需要系统发现时使用 quality-rule-create。

## 建立目标与观察

1. 按用户范围程序化枚举全部 existing target，并按稳定规则顺序入账。
2. glossary：把全部尚无观察的目标作为 patterns 一次调用 `workspace.matchLiterals`；再完整扫描 glossary entries，记录 NFKC 小写后相等或互相包含的范围内外规则 ID。结构关系只作证据。
3. text_preserve：编译全部尚无观察的目标规则，一次流式遍历完整 items，独立累计每条规则的 item、行、片段、`text_type`、文件和有限代表证据；非法或零长度规则也形成明确观察。
4. 把已执行的程序化观察登记为初始信号；初始化只返回目标、观察与完整性数量，以及 System Prompt 所需的范围确认信息，不返回完整集合。

## 分片核验

按 `quality-rule-workflow` 选择处理片段并写回决策。当前片段的每个 target 必须形成一条决策：

- 先按 `quality-rules` 分类为需承载、无需承载或未决。
- 再映射为 keep、update、delete 或 unresolved。
- 需承载但由另一最终规则完整覆盖的旧项可以 delete。
- 新边界或拆分规则先追加为 candidate target，完成正式观察后再决定 create、discard 或 unresolved。
- 零命中不能单独推导删除；缺少身份、边界或值时列为未决。

核验中涌现会影响结论的新维度（同系列一致性、变格形式、译名体系等）同样是信号：按 `quality-rule-workflow` 入账并回放其 `affects` 范围内已形成的 decision，不只在当前片段使用。

## glossary 核验与集合重构

- 使用正式命中和必要邻近语境核验必要性、连续边界、译文、`info` 和用户风格。
- 结构相似不表示语义相同；别名、简称、同一实体形式和公共词根由语境确认后加入 related 事实。
- 语义相关形式按 `quality-rule-workflow` 确定性枚举候选并选择最短安全词根；新增匹配未全部核验时相关目标保持未决。
- 最终词根已存在时保留或更新；不存在时优先把一个被替代 existing ID 更新为词根并删除冗余分支。确需增加规则时使用 candidate create，不为保持旧边界建立补丁条目。
- 全局风格标准在首个处理片段建立初版；任何片段可基于全局证据修正，但不按局部多数重新定义，修正即入账为信号并回放已形成的 decision。

## text_preserve 核验

- 每条规则只依据自己的完整扫描和代表命中判断，不用其它规则命中数替代。
- 表达式修改后必须作为新值重新完成完整扫描，旧观察不能复用。
- 不计算跨规则覆盖率；身份完全重复或保护边界直接冲突时可以互为证据，但仍各自形成决策。

## 完成与方案

按 `quality-rule-workflow` 的共享完整性、授权和提交协议收敛。方案按实际内容汇总现有规则的 keep/update/delete/unresolved、候选的 create/discard/unresolved、变更前后数量、代表证据和全部未决；新候选产生时继续处理，不得提前结束。

本次产生 text_preserve 变更时，说明它们只在文本保护模式为自定义时参与翻译。
