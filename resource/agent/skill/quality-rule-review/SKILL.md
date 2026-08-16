---
name: quality-rule-review
description: 当需要审查、校正、删除或整理当前工程中的术语或文本保护规则时使用；一次执行共享两个领域的结构关系、证据前沿和最终提交。需要主动扫描全工程发现新规则时使用 quality-rule-create。
---

# 质量规则审查入口

读取 `@skill(quality-rule-workflow)`，以 `mode: review` 执行其唯一工作流；由该 workflow 按实际范围加载领域判据。同时审查两个领域也只加载一次工作区，并共享每一代 items 遍历和上下文片段。

## 范围

- 未限定 kind：审查现有 glossary + text_preserve；限定 kind 时只处理指定类型。
- 限定 targets：只有明确规则进入 existing facts；其它规则只作结构、覆盖或语义证据。
- 用户排除项保持原样，不进入事实、计数或变更。
- 不主动扫描全工程发现独立新规则；核验目标时发现的必要替代边界、拆分分支或缺失事实可以成为 candidate fact。需要系统发现时使用 `quality-rule-create`。

初始化时按用户范围程序化枚举全部 existing facts，保持规则稳定顺序；先建立结构组，再在同一次证据编排中取得正式命中和有限语境。glossary 目标使用 `workspace.matchLiterals` 批量匹配；text_preserve 在同一次 items 遍历中累计真实命中、文件、文本类型和代表证据。

每个 existing fact 独立决定：

- required：最终值相同则 keep，需要调整则 update；被其它已验证最终规则完整覆盖时可以 delete，并记录 `covered_by`。
- not_required：delete；不能因存在已久、修改麻烦或当前没有报错而 keep。
- 当前工程零命中且用户未要求清理预置规则：`unknown + preserved + keep`，说明当前没有证据支持修改或删除。
- 只有直接、conditional、narrowed 或拆分全部失败时才单独 blocked；同组其它事实继续处理。

审查中出现 candidate replacement 时与 existing 使用同一聚类算法和发现前沿，但范围外新规则只作观察。结构组、派生匹配和 residual 只扩展目标证据或必要替代事实，不自动扩大用户允许修改的目标。

最终从 scope 内 existing 与必要 replacement candidates 程序化生成 creates、updates 和 deletes；不自动生成 move。对外报告全部目标处置、实际 discovery 代数、残差回执、group / component 拆分、语义合并、preserved 与 blocked；共同审查组不能直接计作同一决定。
