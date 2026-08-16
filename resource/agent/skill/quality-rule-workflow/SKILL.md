---
name: quality-rule-workflow
description: 质量规则创建与审查入口共用的工作区状态、结构聚类、动态发现前沿、分组核验和收敛流程；不独立响应任务。
disable-model-invocation: true
---

# 质量规则共享工作流

入口技能先确定 `mode: create | review`、用户允许的 `kinds` 与目标范围，再读取本技能；范围包含 glossary 时读取 `@skill(glossary-rules)`，包含 text_preserve 时读取 `@skill(text-preserve-rules)`。领域技能只提供事实资格和表达判据；本技能是工作区加载、发现、分组、进度和提交的唯一流程权威。

同一任务只调用一次 `workspace_load`。glossary 与 text_preserve 共用每一代 items 遍历、上下文片段和发现前沿，但分别形成事实、决定和 change；加载两个领域技能不表示执行两遍流程。

## 运行态

当前快照只维护两份 JSONL：

```text
scratch/quality-rule-probes.jsonl
scratch/quality-rule-facts.jsonl
```

probe 是能在确定范围内实际执行的发现或补证工作：

```text
{ key,
  origin: seed | derived | residual,
  parent_keys,
  generation,
  kinds,
  scope,
  method,
  status: pending | exhausted,
  scanned_items?,
  raw_matches?,
  rejected_matches?,
  rejection_reasons?,
  new_fact_keys?,
  changed_fact_keys? }
```

- `key` 在当前任务内唯一；`scope` 说明完整作用面，`method` 说明可以程序执行的筛选、匹配或上下文调查。只写“继续观察”“再检查类似内容”不构成 probe。
- `seed` 是初始化方向，至少一个不依赖已有规则；`derived` 必须由具体新事实、关系、新匹配或边界反例产生；`residual` 使用尚未执行的独立方向调查长尾。
- 同一代所有 pending probes 跨 kind 合并到一次 `workspace_script` 遍历中执行；能从已有 observation 回答的 probe 不重复扫描 items。`status: exhausted` 只表示声明的 scope 已完整执行且没有截断。
- probe 按 `{ kinds, scope, method }` 去重；等价工作不能通过换 key 重新执行。结果过大时完整写入 facts，只向模型返回计数、变化 key 和少量代表证据。

fact 是需要独立决定的业务事实：

```text
{ key,
  kind: glossary | text_preserve,
  origin: candidate | existing,
  id?,
  probe_keys,
  observation,
  decision? }
```

- `key` 跨 kind 唯一且稳定；existing 携带规则 `id`。`probe_keys` 保存全部实际发现或补证来源，不再维护重复的 signal 计数与 decision 引用子集。
- 每个有效唯一身份先成为 fact，再由领域技能判断；频率、长度、已有译文、现有规则覆盖、证据难度、结构组或预计动作都不是入账前过滤条件。重复身份合并 observation 和 probe 来源，不能消失。
- `decision` 分别保存 `necessity: required | not_required | unknown`、`resolution: direct | conditional | narrowed | preserved | blocked`、`action`，以及需要的完整 `value`、`preserve_reason`、`covered_by` 或 `blocker`。
- candidate action 为 `create | discard | blocked`；existing action 为 `keep | update | delete | blocked`。`preserved` 只用于当前工程缺少评价证据的 existing；blocked 只在直接、条件化和收窄或拆分都失败后使用，并说明缺失事实、已执行下钻、失败原因与处理建议。

上述 JSONL 是领域任务资产，不是另一套公开协议。不要为它建立严格字段 validator；脚本按实际结果生成和更新记录，最终 change 仍以 workspace contract 与 `workspace_apply` 校验为准。

## 任务进度

本工作流属于动态长任务，开始时调用一次 `task_progress` 的 `start` action，至少登记：

```text
discover:seed      基础发现或目标初始化
discover:residual  独立残差调查
finalize:changes   生成方案、完成授权路径并核对结果
```

初始化结果形成结构组后，在完成 `discover:seed` 的同一次 `advance` 中追加稳定的 `review:<kind>:<group_id>` 工作项。完成审查组时，如果实际结果产生 derived probes，在同一次 `advance` 中追加对应代的 `discover:gN`；新增 facts 重新聚类后再追加受影响的 review group。不要为每条程序化事实建立进度项，工作项只表示需要模型继续处理的批次或代。

`finalize:changes` 只能在无变化结论已经核对，或授权后的 apply 已取得真实回执时完成；等待用户授权期间保持 pending。恢复、压缩或进度不明时先调用 `task_progress` 的 `read`。只有本技能的收敛条件全部满足后才 `finish`；用户放弃或用冲突任务替换当前任务时才 `cancel`。进度工具只防止遗忘已知工作，不证明领域发现完整。

## 确定性结构聚类

事实入账后、模型逐项判断前，按 kind 调用 `workspace.runRecipe("query-quality-rule-groups", ...)`：

- review 既有规则时可以省略 `entries` 并用 `target_entry_ids` 限定目标；范围外成员只作共同审查证据。
- create 或出现 candidate 时，把相关 existing 与 candidate facts 程序化投影为同一 `{ entry_id, src, case_sensitive? }` 数组；两类条目必须使用同一算法。
- recipe 返回稳定、互斥、最多 16 条的 group。超大强 component 保留共同 `component_ids` 并分组，通过 `cross_group_relations` 返回被切开的直接边。
- `equivalent`、`contains` 和 `shared_root` 只说明共同审查原因，不证明同义、必要或可合并。弱关系不传递；每个 fact 独立决定，单项失败或 blocked 不得沿 group、component 或跨组关系传播。

glossary 组内确认一个明确子集语义相关后，才调用 `derive-common-literal-roots` 枚举合并候选，再用 `workspace.matchLiterals` 验证真实覆盖。结构组的机械 shared root 不能直接成为最终规则。text_preserve 的正则源码不参与包含或公共字符关系，只把完全相同的源码作为 equivalent 共同审查。

## 动态发现闭环

1. **初始化**：根据入口模式执行 seed probes。create 从分散样本选择领域基础方向后完整扫描；review 枚举全部目标 existing facts，并在同一次初始化中取得正式命中和有限语境。两个 kind 的程序化 probes 合并遍历。
2. **逐组核验**：按稳定 group 顺序读取必要事实和有限语境，逐项形成 decision。每组结束时只从具体新信息提出 probe：同槽位或系列成员、别名、公共片段、相邻结构、译法分歧、条件分支、正则形态或边界反例。
3. **执行派生代**：批量执行当前代全部 pending probes，更新 facts 和 observation。新增事实或决策相关观察时重新聚类受影响 kind，只重开实际变化的 facts，并继续下一代。
4. **反馈工具结果**：聚类的范围外关系、词根验证中 `R - B` 的新增匹配、条件化调查发现的义项、text_preserve 收窄发现的结构变体，都必须进入 fact 或具体 derived probe，不能只用于接受或拒绝当前方案。
5. **独立残差**：至少执行一次不同于 seed 与既有 derived probes 的 residual。它按文件、章节、结构层或缺少明显形式信号的单次概念调查未覆盖长尾；有增量时重新进入分组与派生代。
6. **零增量闭合**：第 0 代不能直接完成。任一代产生新 fact 或决策相关 observation，下一代必须执行；只有之后一个完整代产生零新增 fact、零 changed fact、零新 probe，才允许收敛。

派生不是要求凭空制造新方向。若一个具体模式无法形成可执行 probe，把它作为当前 fact 的 observation；重复证据不建立新代。反过来，只要存在尚未执行的具体 probe，就不能用“已完成一轮”结束。

### 闭环判例

| 当前结果 | 必须追加的工作 | 不能直接得出的结论 |
| --- | --- | --- |
| 词根覆盖比分支集合多出 8 个 item | 建立 probe，分类这 8 项是遗漏成员还是边界反例 | “词根不安全，所以结束该系列” |
| 一个角色名事实暴露同一姓名槽位中的其它字面量 | 完整扫描该槽位并把有效唯一身份入账 | “当前角色已处理，所以名称发现完成” |
| 宽占位符同时命中结构与正文 | 按定界符或位置差异建立收窄 probe | “宽规则失败，所以该结构无需保护” |
| 派生代没有产生新 fact、changed fact 或新 probe | 若 residual 已完成且 facts 均已决定，可以收敛 | 为凑轮次重复同一扫描 |

## 从不确定到可执行

对不能直接决定的 fact 依次执行：

1. 围绕缺失维度批量取得完整匹配与有限代表语境；
2. 合理未知取值不改变最终字段时采用稳健直接值；
3. glossary 的适用条件能由翻译输入判断时，以 `info` 形成 conditional；
4. 缩小连续字面边界或正则，或拆出行为确定的独立事实；
5. 只有上述路径全部失败才 blocked，并保留其它已经闭合事实。

集合优化失败只回退已经验证的精确规则，不改变底层 required 事实。范围外冲突只阻止需要越权修改的具体方案，不传播到能够独立处理的事实。

## 收敛与写入

只有同时满足以下条件才能形成最终方案：

- seed、所有派生 probes 与独立 residual 均完整执行且没有截断；
- 所有 group 分页和 task_progress 工作项已经处理，跨组关系没有遗失待核验事实；
- 所有 facts 都有闭合 decision，且最近完整发现代为零增量；
- 每个 required fact 由直接、条件化或收窄后的最终规则覆盖，或在穷尽降级路径后单独 blocked；
- glossary 最小充分集合与 text_preserve 独立安全集合已经分别重构。

从 facts 程序化生成当前 scope 的完整 changes；未选 kind、范围外规则和替换规则 change 文件保持为空，不自动生成 move。脚本先返回遗漏 decision、action 计数和拟写 change 数；存在遗漏时不写 change。没有真实 change 时不 apply；已有授权时默认一次 `workspace_apply` 原子提交完整方案并核对回执，然后完成 `task_progress`。

对外报告实际范围、probe 代数与覆盖回执、各 kind 的 group / component 与拆分数量、necessity / resolution / action 计数、变更前后数量、最少代表证据、全部 blocked 及处理建议和范围外观察。结构组数与 shared root 数不得冒充语义合并数；完成只证明声明的 probes、facts 与 residual 已收敛，不宣称穷尽所有理论规则。
