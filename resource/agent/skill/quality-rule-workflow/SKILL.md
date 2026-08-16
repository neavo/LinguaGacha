---
name: quality-rule-workflow
description: 质量规则创建与审查共用的任务账本、信号回放、完整性、处理片段、授权提交与词根验证协议；不独立响应任务，仅在两个工作流技能中经引用加载。
disable-model-invocation: true
---

# 质量规则任务协议

本技能是 `quality-rule-create` 与 `quality-rule-review` 的共享执行协议；领域判据、字段语义与词根采用条件以 `@skill(quality-rules)` 为准。

## 任务账本

每个处理批次只调用一次 `workspace_load` 建立当前快照；apply 后继续下一批时按 System Prompt 重新 load。统一使用当前快照内的四个文件，不为小任务建立第二套流程：

```text
scratch/quality-rule-signals.jsonl
scratch/quality-rule-targets.jsonl
scratch/quality-rule-observations.jsonl
scratch/quality-rule-decisions.jsonl
```

`signals` 是产生观察的全部作业方式；创建侧的发现扫描与审查侧的核验维度同属信号。每行包含 `{ name, scope, affects }`：`scope` 声明作用面（数据集或目标结论类别），`affects` 声明该信号影响的结论类别。只有预计会改变至少一条已有结论或产生新目标的信号才入账；不影响结论的视角差异不入账。信号必须整体执行并覆盖其完整作用面，被截断的执行视为未执行。

`targets` 是完整业务目标清单。现有规则使用 `{ key, origin: "existing", kind, id, order }`；发现候选使用 `{ key, origin: "candidate", kind, order, seed }`。`key` 在当前快照内唯一且不可修改，`order` 单调递增。新事实必须先成为 target，才能形成处置。

`observations` 每个 target 恰好一行，至少包含 `{ key, signals, exhausted, truncated }` 和当前 kind 的完整程序化统计；`signals` 记录该观察已经通过的信号。完整计数保存在磁盘，模型只读取当前判断所需的有限代表证据。

`decisions` 每个 target 最终恰好一行，包含 `{ key, fact, action }`、必要证据和具体值：

- existing action：`keep | update | delete | unresolved`。
- candidate action：`create | discard | unresolved`。
- `update` / `create` 提供当前 kind 的完整最终字段；其它 action 不携带 value。
- `unresolved` 必须同时使用 `fact: unresolved`，写明非空 `missing_fact`，且不进入 change。
- 需承载事实对应的现有规则若删除，必须以 `covered_by` 指向在匹配、译法和必要 `info` 上完整覆盖它的最终规则。

`workspace_load` 后先检查 `task/quality-rule-carryover.json`：存在时把其中未决目标重建为 target、恢复已确认的风格标准与范围外观察，observations 一律按当前快照重算，吸收后删除该文件。该交接文件是唯一跨 apply 保留的任务资产，其余账本只属于当前快照。

结构相似、字面包含、公共词根、别名和同一语境只扩展证据范围，不自动扩大修改目标。范围外规则只有在用户范围允许修改时才追加为 existing target；否则保持只读，冲突无法在当前权限内解决时将受影响目标列为未决。

## 信号回放

新信号入账即触发回放：凡结论属于其 `affects` 且已经形成 decision 的目标，必须用该信号重验，重验直接改写原 decision；暂不能重验的降级为 unresolved 并写明缺失事实。初始程序化观察同样登记为初始信号，涌现信号与初始信号共用同一协议。

## 处理片段

处理片段只控制模型上下文，大小完全遵循 System Prompt 的审查组与上下文规则，不另设数量阈值。每个片段必须完整返回所需事实；放不下时缩小片段，不得截断、抽样或改变业务范围。

## 完整性条件

只有同时满足三个闭合才能报告完整并形成最终方案：

- 目标闭合：`targets.key`、`observations.key`、`decisions.key` 三个集合完全相等且各自无重复；全部引用能够解析，字段和 action 符合 target origin 与 kind。
- 观察闭合：全部 observation 均为 `exhausted: true`、`truncated: false`，且其 `signals` 覆盖 `affects` 命中该目标的全部信号。
- 结论闭合：连续一个完整处理轮次内没有新目标、没有新信号，也没有 decision 被回放改写。

任一闭合不满足只能报告部分进度或阻塞。

## 授权与提交

未获明确项目写入授权时只形成方案，不写 contract change 文件或调用 `workspace_apply`。获得授权后，从 decisions 程序化生成当前 scope 的完整 changes；未使用的 quality kind 和全部替换规则 change 文件保持为空。不要自动生成 move；没有真实 change 时不要 apply。默认一次 apply 提交完整授权方案，并按回执核对各 kind 的真实新增、修改、删除、移动数量和 revision。apply 前把跨批仍有价值的资产写入 `task/quality-rule-carryover.json`：已确认的全局风格标准、全部 unresolved 目标（含 `missing_fact` 与必要证据）和范围外观察；三者均无内容时不写。apply 成功后账本随快照销毁，该文件由下一批吸收后删除。

## 词根候选验证

先用语境确认需要共同处理的形式确实语义相关，再以这些显式词形调用 `workspace.runRecipe("derive-common-literal-roots", { forms })`，取得按 grapheme 长度从短到长排列的全部公共连续片段。不要靠模型临时猜测、任意最短长度或预计算全局关系组代替候选枚举。

按 recipe 顺序对语义成立的候选执行验证，采用条件以 `quality-rules` 的词根合并判据为准。准备替代多个分支时，分别以全部分支和“当前候选词根 + 全部分支”调用 `workspace.matchLiterals`，使用顶层 item 并集计数比较基线 B 与候选 R，并核验全部新增匹配：R = B 且无其它反例时采用；R > B 只有在新增匹配证据已经耗尽且全部安全时采用；R < B、发现误匹配或新增证据未耗尽时拒绝或列为未决。选择第一个通过全部条件的候选，即最短安全词根；没有候选通过时保留必要分支。
